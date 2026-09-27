import XCTest
import simd

final class PhraseBookTests: XCTestCase {
    static let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../StepSafe/Phrases").standardizedFileURL

    func book() throws -> PhraseBook {
        try PhraseBook(json: Data(contentsOf: Self.dir.appendingPathComponent("phrases.json")))
    }

    /// Every phrase AlertPolicy and the crossing code can produce: path guard kinds over the whole lane
    /// (0.5-5 m) and sides, closing labels (depth "Object" and every YOLO class) and sides, what's-ahead
    /// composites, and every notice.
    func producible() -> [String] {
        var out: [String] = []
        for kind in [HazardKind.dropOff, .headHeight, .ground] {
            for ahead in stride(from: Float(0.5), through: Tuning.laneFarM, by: 0.1) {
                for lateral: Float in [-0.3, 0, 0.3] {
                    var d = Detection(kind: kind, point: .zero, ahead: ahead, lateral: lateral, pointCount: 100)
                    out.append(AlertPolicy.phrase(d))
                    if kind == .dropOff { d.slope = true; out.append(AlertPolicy.phrase(d)) }
                }
            }
        }
        let labels: [String?] = [nil] + ["car", "truck", "bus", "motorcycle", "bicycle", "person"].map(BoxTracker.spokenLabel)
        for label in labels {
            for lateral: Float in [-2, 0, 2] {
                out.append(AlertPolicy.phrase(Detection(kind: .closing, point: .zero, ahead: 6, lateral: lateral, pointCount: 0,
                                                        closing: .init(speed: 2, ttc: 3, label: label))))
            }
        }
        let drop = Detection(kind: .dropOff, point: .zero, ahead: 1.2, lateral: 0, pointCount: 300)
        out.append(AlertPolicy.whatsAheadPhrase([.dropOff: drop], atCurb: true))
        out.append(AlertPolicy.whatsAheadPhrase([:], atCurb: true))
        out.append(AlertPolicy.whatsAheadPhrase([:], atCurb: false))
        // Combined alert when a closing object and a drop-off are both urgent.
        var combo = Detection(kind: .closing, point: .zero, ahead: 3, lateral: 2, pointCount: 0,
                              closing: .init(speed: 2, ttc: 1.5, label: "Car", trackId: 1))
        combo.closing?.dropOffPoint = SIMD3(0, 0, -1)
        out.append(AlertPolicy.phrase(combo))
        XCTAssertEqual(AlertPolicy.phrase(combo), "Car approaching, right. Drop-off ahead.")
        return out + Notices.all
    }

    func testEveryProducedPhraseHasAClipInBothLanguages() throws {
        let b = try book()
        let fm = FileManager.default
        let exists = { (name: String) in fm.fileExists(atPath: Self.dir.appendingPathComponent("\(name).mp3").path) }
        for text in Set(producible()) {
            XCTAssertNotNil(b.ids(for: text), "no phrase id for \"\(text)\"")
            for lang in ["en", "es"] {
                // Its own clips, or (not recorded yet: "Slope down") its fallback's recorded clips.
                XCTAssertNotNil(b.clipNames(for: text, lang: lang, exists: exists), "\(text) (\(lang))")
            }
        }
        XCTAssertEqual(Set(b.entries.map(\.id)).count, b.entries.count, "ids are unique")
    }

    /// Each path guard clip says what AlertPolicy says for its id's kind, metre bucket and side, and the Spanish
    /// clip is the same alert word for word (a drifted English text would silently fall back to device speech).
    func testPathGuardEntriesMatchAlertPolicy() throws {
        let kinds: [String: HazardKind] = ["dropoff": .dropOff, "slope": .dropOff, "head": .headHeight, "obstacle": .ground]
        let laterals: [String: Float] = ["left": -0.3, "ahead": 0, "right": 0.3]
        let nombres = ["dropoff": "Desnivel", "slope": "Pendiente", "head": "A la altura de la cabeza", "obstacle": "Obstáculo"]
        let lados = ["left": "izquierda", "ahead": "al frente", "right": "derecha"]
        let entries = try book().entries.filter { $0.id.hasPrefix("pg-") }
        XCTAssertEqual(entries.count, 60)
        for e in entries {
            let parts = e.id.split(separator: "-").map(String.init) // pg, kind, metre bucket, side
            guard parts.count == 4, let kind = kinds[parts[1]], let metres = Float(parts[2]), let lateral = laterals[parts[3]]
            else { XCTFail("unexpected id \(e.id)"); continue }
            var d = Detection(kind: kind, point: .zero, ahead: metres, lateral: lateral, pointCount: 100)
            d.slope = parts[1] == "slope"
            XCTAssertEqual(e.en, AlertPolicy.phrase(d), e.id)
            let feet = AlertPolicy.phrase(d).components(separatedBy: ", ")[1].replacingOccurrences(of: "feet", with: "pies")
            XCTAssertEqual(e.es, "\(nombres[parts[1]]!), \(feet), \(lados[parts[3]]!)", e.id)
        }
    }

    func testFallbackToSpeechWhenAClipIsMissingOrTextIsNotFixed() throws {
        let b = try book()
        let text = "Drop-off, 3 feet, ahead. Nothing detected. Listen before crossing."
        XCTAssertEqual(b.clipNames(for: text, lang: "es", exists: { _ in true }),
                       ["pg-dropoff-1-ahead.es", "n-listen-before-crossing.es"]) // a phrase may contain ". "
        XCTAssertNil(b.clipNames(for: text, lang: "en", exists: { $0 != "n-listen-before-crossing.en" })) // one missing
        XCTAssertNil(b.clipNames(for: "Trash bin, 6 feet, left", lang: "en", exists: { _ in true })) // server label
        XCTAssertEqual(b.ids(for: "Desnivel, 6 pies, izquierda"), ["pg-dropoff-2-left"]) // Spanish text maps too
        XCTAssertNil(b.ids(for: "Drop-off, 3 feet, ahead. Trash bin")) // a partly fixed text is spoken whole
        // Wording rules: never "clear"/"safe" (or Spanish equivalents), formal usted, Miami "carro".
        for e in b.entries {
            for text in [e.en, e.es] {
                XCTAssertNil(text.range(of: "\\b(clear|safe|despejad[oa]|segur[oa]|coche|reinicia|escucha)\\b",
                                        options: [.regularExpression, .caseInsensitive]), text)
            }
        }
    }

    func testPriorityOneThroughClipsIsStillNeverMuted() throws {
        let b = try book()
        var policy = AlertPolicy()
        policy.setMuted(true, now: 0)
        let drop = Detection(kind: .dropOff, point: SIMD3(0, 0, -1.5), ahead: 1.5, lateral: 0, pointCount: 300)
        let car = Detection(kind: .closing, point: SIMD3(3, 1, -8), ahead: 8.5, lateral: 3, pointCount: 0,
                            closing: .init(speed: 8, ttc: 1, label: "Car"))
        for d in [drop, car] {
            XCTAssertEqual(AlertPolicy.priority(d), 1)
            XCTAssertNotNil(b.ids(for: AlertPolicy.phrase(d))) // it plays as a bundled clip...
            XCTAssertEqual(policy.next([d.kind: d], now: 1, playing: nil)?.kind, d.kind) // ...and mute cannot stop it
            XCTAssertFalse(AlertPolicy.mayStart(AlertPolicy.onRequestPriority, over: 1))
        }
    }

    func testSlopeFallsBackToRecordedDropOffClips() throws {
        let b = try book()
        let text = "Slope down, 6 feet, left"
        XCTAssertEqual(b.ids(for: text), ["pg-slope-2-left"])
        XCTAssertEqual(b.ids(for: "Pendiente, 6 pies, izquierda"), ["pg-slope-2-left"])
        // Not recorded yet: the drop-off clip plays (the scarier words), never device speech.
        XCTAssertEqual(b.clipNames(for: text, lang: "es", exists: { !$0.hasPrefix("pg-slope-") }), ["pg-dropoff-2-left.es"])
        // Recorded: its own clip.
        XCTAssertEqual(b.clipNames(for: text, lang: "en", exists: { _ in true }), ["pg-slope-2-left.en"])
        // Only slope phrases fall back.
        XCTAssertNil(b.clipNames(for: "Drop-off, 6 feet, left", lang: "en", exists: { !$0.hasPrefix("pg-dropoff-") }))
    }

    func testEveryRecordedClipExistsInBothLanguages() throws {
        // A slope clip recorded in one language only would play "Slope down" in one and "Drop-off" in the other.
        let fm = FileManager.default
        for e in try book().entries {
            let has = ["en", "es"].map { fm.fileExists(atPath: Self.dir.appendingPathComponent("\(e.id).\($0).mp3").path) }
            XCTAssertEqual(has[0], has[1], e.id)
        }
    }

    func testUrgentClipsAreDecodedUpFront() throws {
        // Priority 1 (within 2 m, and anything closing): drop-off and slope metre buckets 1-2, every closing phrase.
        let ids = try book().entries.map(\.id)
        let urgent = Set(PhraseBook.urgent(ids))
        for side in ["left", "right", "ahead"] {
            for m in [1, 2] {
                XCTAssertTrue(urgent.contains("pg-dropoff-\(m)-\(side)"))
                XCTAssertTrue(urgent.contains("pg-slope-\(m)-\(side)"))
            }
            XCTAssertFalse(urgent.contains("pg-slope-3-\(side)"))
            XCTAssertFalse(urgent.contains("pg-obstacle-1-\(side)"))
        }
        XCTAssertEqual(urgent.filter { $0.hasPrefix("cl-") }.count, ids.filter { $0.hasPrefix("cl-") }.count)
        XCTAssertEqual(urgent.count, 12 + ids.filter { $0.hasPrefix("cl-") }.count)
    }
}
