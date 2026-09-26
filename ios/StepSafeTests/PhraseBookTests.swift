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
                    out.append(AlertPolicy.phrase(Detection(kind: kind, point: .zero, ahead: ahead, lateral: lateral, pointCount: 100)))
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
        for text in Set(producible()) {
            let ids = try XCTUnwrap(b.ids(for: text), "no phrase id for \"\(text)\"")
            for id in ids {
                for lang in ["en", "es"] {
                    XCTAssertTrue(fm.fileExists(atPath: Self.dir.appendingPathComponent("\(id).\(lang).mp3").path), "\(id).\(lang).mp3")
                }
            }
        }
        XCTAssertEqual(Set(b.entries.map(\.id)).count, b.entries.count, "ids are unique")
    }

    func testFallbackToSpeechWhenAClipIsMissingOrTextIsNotFixed() throws {
        let b = try book()
        let text = "Drop-off, 1 meter, ahead. Nothing detected. Listen before crossing."
        XCTAssertEqual(b.clipNames(for: text, lang: "es", exists: { _ in true }),
                       ["pg-dropoff-1-ahead.es", "n-listen-before-crossing.es"]) // a phrase may contain ". "
        XCTAssertNil(b.clipNames(for: text, lang: "en", exists: { $0 != "n-listen-before-crossing.en" })) // one missing
        XCTAssertNil(b.clipNames(for: "Trash bin, 2 meters, left", lang: "en", exists: { _ in true })) // server label
        XCTAssertEqual(b.ids(for: "Desnivel, 2 metros, izquierda"), ["pg-dropoff-2-left"]) // Spanish text maps too
        XCTAssertNil(b.ids(for: "Drop-off, 1 meter, ahead. Trash bin")) // a partly fixed text is spoken whole
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
}
