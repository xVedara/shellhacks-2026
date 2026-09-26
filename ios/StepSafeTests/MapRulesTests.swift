import CoreGraphics
import simd
import XCTest

final class MapRulesTests: XCTestCase {
    let home = Geo.Fix(lat: 25.7563, lng: -80.3739)
    let mPerDegLat = 6_378_137.0 * .pi / 180

    /// A pin `m` metres from home at compass `bearing`.
    func pin(_ id: String, _ m: Double, _ bearing: Double, band: String = "ground", status: String = "active",
             sample: Bool = false, from origin: Geo.Fix? = nil) -> NearHazard {
        let r = bearing * .pi / 180
        let f = Geo.offset(origin ?? home, east: m * sin(r), north: m * cos(r))
        return NearHazard(id: id, type: "trash bin", category: "moving", lat: f.lat, lng: f.lng, heightBand: band,
                          confidence: 1, status: status, label: "trash bin", sample: sample)
    }

    func detection(_ kind: HazardKind, _ p: SIMD3<Float>, ahead: Float = 2, lateral: Float = 0) -> Detection {
        Detection(kind: kind, point: p, ahead: ahead, lateral: lateral, pointCount: 100)
    }

    // MARK: Localizer

    func testLocalizerEastNorthOffsets() {
        // AR: +x east, -z north. Point 3 m east and 4 m north of a camera at (1, 1.6, 2).
        let cam = SIMD3<Float>(1, 1.6, 2)
        let f = Geo.locate(cam + SIMD3(3, -1.5, -4), camera: cam, cameraFix: home)
        XCTAssertEqual(f.lat - home.lat, 4 / mPerDegLat, accuracy: 1e-9)
        XCTAssertEqual(f.lng - home.lng, 3 / (mPerDegLat * cos(home.lat * .pi / 180)), accuracy: 1e-9)
        XCTAssertEqual(Geo.distance(home, f), 5, accuracy: 0.01)
        XCTAssertEqual(Geo.bearing(from: home, to: f), 36.87, accuracy: 0.05)
        // West and south are negative.
        let sw = Geo.locate(cam + SIMD3(-10, 0, 10), camera: cam, cameraFix: home)
        XCTAssertLessThan(sw.lat, home.lat)
        XCTAssertLessThan(sw.lng, home.lng)
    }

    func testCameraHeadingFromARTransform() {
        XCTAssertEqual(Geo.cameraHeading(matrix_identity_float4x4)!, 0, accuracy: 1e-6) // looks down -z = north
        // Yaw 90 degrees clockwise seen from above: forward becomes +x = east.
        let east = simd_float4x4(simd_quatf(angle: -.pi / 2, axis: SIMD3(0, 1, 0)))
        XCTAssertEqual(Geo.cameraHeading(east)!, 90, accuracy: 1e-4)
        XCTAssertEqual(Geo.relative(350, to: 10), -20, accuracy: 1e-9)
        XCTAssertEqual(Geo.relative(10, to: 350), 20, accuracy: 1e-9)
    }

    // MARK: Heads-up

    func testHeadsUpAheadFilterAndPhrase() {
        let pins = [pin("ahead", 10, 5), pin("left", 6, 330), pin("wide", 10, 60), pin("far", 13, 0),
                    pin("behind", 5, 180), pin("cleared", 3, 0, status: "cleared")]
        let due = HeadsUpState.ahead(pins, walker: home, heading: 0)
        XCTAssertEqual(due.map(\.pin.id), ["left", "ahead"]) // nearest first; outside cone, too far, behind, cleared dropped
        XCTAssertEqual(Spoken.headsUp(due[0]), "Trash bin, 20 feet, left") // 6 m = 19.7 ft -> 20
        XCTAssertEqual(Spoken.headsUp(due[1]), "Trash bin, 35 feet, ahead") // 10 m = 32.8 ft -> 35, 5 degrees off
        // Walking west, the north pin is to the right and outside the cone.
        XCTAssertTrue(HeadsUpState.ahead(pins, walker: home, heading: 270).isEmpty)
        XCTAssertEqual(HeadsUpState.ahead([pin("r", 10, 300)], walker: home, heading: 270).first.map(Spoken.headsUp),
                       "Trash bin, 35 feet, right")
    }

    func testHeadsUpReleaseLetsADroppedPinSpeakAgain() {
        var s = HeadsUpState()
        let pins = [pin("a", 5, 0)]
        XCTAssertEqual(s.next(pins, walker: home, heading: 0, now: 0)?.pin.id, "a")
        XCTAssertNil(s.next(pins, walker: home, heading: 0, now: 1))
        s.release("a")
        XCTAssertEqual(s.next(pins, walker: home, heading: 0, now: 2)?.pin.id, "a")
    }

    func testHeadsUpSpanishUsesTaxonomyNameAndPies() throws {
        let tax = [HazardTypeEntry(id: "trash-bin", en: "trash bin", es: "cubo de basura", category: "moving",
                                   defaultHeightBand: "ground")]
        var p = pin("left", 6, 330)
        p.type = "trash-bin"
        let due = try XCTUnwrap(HeadsUpState.ahead([p], walker: home, heading: 0).first)
        XCTAssertEqual(Spoken.headsUp(due, lang: "es", taxonomy: tax), "Cubo de basura, 20 pies, izquierda")
        XCTAssertEqual(Spoken.headsUp(due), "Trash bin, 20 feet, left") // no taxonomy: the English label
        XCTAssertEqual(Taxonomy.localize("Trash Bin", lang: "es", in: tax), "cubo de basura")
        XCTAssertEqual(Taxonomy.localize("Trash Bin", lang: "en", in: tax), "Trash Bin")
        XCTAssertEqual(Taxonomy.localize("open manhole", lang: "es", in: tax), "open manhole")
        XCTAssertEqual(Spoken.named("cubo de basura", detection(.ground, .zero, ahead: 3, lateral: 0.4), lang: "es"),
                       "Cubo de basura, 9 pies, derecha")
    }

    func testHeadsUpOncePerPinPerFiveMinutes() {
        var s = HeadsUpState()
        let pins = [pin("a", 5, 0), pin("b", 10, 0)]
        XCTAssertEqual(s.next(pins, walker: home, heading: 0, now: 0)?.pin.id, "a")
        XCTAssertEqual(s.next(pins, walker: home, heading: 0, now: 1)?.pin.id, "b")
        XCTAssertNil(s.next(pins, walker: home, heading: 0, now: 299))
        XCTAssertEqual(s.next(pins, walker: home, heading: 0, now: 300)?.pin.id, "a")
    }

    // MARK: Report once per identity, skip if known, retries

    func testReportOncePerIdentity() {
        var g = ReportGate()
        let d = detection(.ground, SIMD3(0, 0.5, -2))
        XCTAssertTrue(g.isNew(d, now: 0))
        g.mark(d)
        XCTAssertEqual(g.state(d), .inFlight)
        XCTAssertFalse(g.isNew(detection(.ground, SIMD3(0.5, 0.5, -1.6)), now: 0)) // slid 0.64 m: same identity
        XCTAssertTrue(g.isNew(detection(.headHeight, SIMD3(0, 0.5, -2)), now: 0)) // other kind
        XCTAssertTrue(g.isNew(detection(.ground, SIMD3(0, 0.5, -3)), now: 0)) // 1 m from the FIRST point
        g.succeeded(d)
        XCTAssertEqual(g.state(d), .reported)
        XCTAssertFalse(g.isNew(d, now: 1000))
        g.reset()
        XCTAssertTrue(g.isNew(d, now: 0))
    }

    func testReportMarkedOnlyAfterSuccessRetriesThenCooldown() {
        // Transport error (nil), 429 and 5xx: two retries, 2 s then 4 s, then stop.
        for status in [nil, 429, 500, 503] as [Int?] {
            XCTAssertEqual(ReportGate.retryDelay(failures: 1, status: status), 2)
            XCTAssertEqual(ReportGate.retryDelay(failures: 2, status: status), 4)
            XCTAssertNil(ReportGate.retryDelay(failures: 3, status: status))
        }
        XCTAssertNil(ReportGate.retryDelay(failures: 1, status: 400)) // bad request never retried
        XCTAssertNil(ReportGate.retryDelay(failures: 1, status: 404))
        var g = ReportGate()
        let d = detection(.ground, SIMD3(0, 0.5, -2))
        g.mark(d)
        g.failed(d, now: 10) // retries exhausted: not reported, retry after the cooldown
        XCTAssertNotEqual(g.state(d), .reported)
        XCTAssertFalse(g.isNew(d, now: 10 + MapTuning.reportCooldownSeconds - 1))
        XCTAssertTrue(g.isNew(d, now: 10 + MapTuning.reportCooldownSeconds))
        g.mark(d)
        XCTAssertEqual(g.state(d), .inFlight)
    }

    func testSkipIfKnownPinSameBandWithin10mNotSamples() {
        let pins = [pin("g8", 8, 90), pin("h3", 3, 0, band: "head"), pin("g15", 15, 0), pin("gc", 1, 0, status: "cleared"),
                    pin("s2", 2, 0, sample: true)]
        XCTAssertEqual(ReportGate.knownPin(band: "ground", at: home, in: pins)?.id, "g8") // sample at 2 m ignored
        XCTAssertEqual(ReportGate.knownPin(band: "head", at: home, in: pins)?.id, "h3")
        XCTAssertNil(ReportGate.knownPin(band: "dropoff", at: home, in: pins))
        XCTAssertNil(ReportGate.knownPin(band: "ground", at: home, in: [pin("g11", 11, 0)]))
        XCTAssertNil(ReportGate.knownPin(band: "ground", at: home, in: [pin("s", 1, 0, sample: true)]))
        XCTAssertEqual(HazardKind.headHeight.band, "head")
        XCTAssertEqual(HazardKind.dropOff.band, "dropoff")
        // The skipped report speaks the known pin's name with path guard's distance and side.
        XCTAssertEqual(Spoken.named(pins[0].spokenName, detection(.ground, .zero, ahead: 3, lateral: 0.4)), "Trash bin, 9 feet, right")
    }

    // MARK: Passive downvote (off by default; tests force it on)

    struct Walk {
        var accuracy: Double = 4
        var age: Double = 1
        var outputAge: Double? = 0.1
        var floorUnder = true
    }

    /// Walk north from `start` m south of the pin to `endM`, one step per `stepM` metres and second.
    /// `at` overrides the step conditions at a given distance. Returns the votes.
    func walk(_ v: inout PassiveVoter, _ pins: [NearHazard], to endM: Double = 0.9, start: Double = 9, stepM: Double = 1,
              t0: Double = 100, at: (Double) -> Walk = { _ in Walk() }, jumpAt: Double? = nil) -> [String] {
        var votes: [String] = []
        var d = start, t = t0
        while d >= endM - 1e-9 {
            let w = at(d)
            var shown = d
            if let j = jumpAt, abs(d - j) < 1e-6 { shown = d + 2.5 } // GPS jumps 2.5 m back for one step
            let step = PassiveVoter.Step(walker: Geo.offset(home, east: 0, north: -shown), heading: 0, accuracyM: w.accuracy,
                                         fixAgeS: w.age, outputAgeS: w.outputAge, floorUnder: w.floorUnder, now: t)
            votes += v.step(pins, step).map(\.id)
            d -= stepM; t += 1
        }
        return votes
    }

    func voter() -> PassiveVoter { var v = PassiveVoter(); v.enabled = true; return v }

    func testPassiveDownvoteOffByDefault() {
        XCTAssertFalse(Tuning.passiveDownvotesEnabled)
        var off = PassiveVoter()
        XCTAssertEqual(walk(&off, [pin("p", 0, 0)]), []) // a perfect approach, flag off: never votes
    }

    func testPassiveDownvoteAllConditions() {
        let p = pin("p", 0, 0) // the pin at home
        var v = voter()
        XCTAssertEqual(walk(&v, [p], to: 2.05, start: 9.05), []) // 8.05 ... 2.05: not yet within 2 m
        var ok = voter()
        XCTAssertEqual(walk(&ok, [p]), ["p"]) // 8 samples over 7 s, reaches 1 m: vote
        XCTAssertEqual(walk(&ok, [p], to: 0.4, start: 0.5, t0: 200), []) // once per pin

        var poorGPS = voter(), staleFix = voter(), staleOutput = voter(), noOutput = voter(), estimated = voter()
        XCTAssertEqual(walk(&poorGPS, [p], at: { $0 == 5 ? Walk(accuracy: 6) : Walk() }), []) // one bad fix mid-way
        XCTAssertEqual(walk(&staleFix, [p], at: { $0 == 4 ? Walk(age: 3.5) : Walk() }), [])
        XCTAssertEqual(walk(&staleOutput, [p], at: { $0 == 6 ? Walk(outputAge: 0.5) : Walk() }), [])
        XCTAssertEqual(walk(&noOutput, [p], at: { _ in Walk(outputAge: nil) }), [])
        XCTAssertEqual(walk(&estimated, [p], at: { $0 == 3 ? Walk(floorUnder: false) : Walk() }), []) // nearest/estimate floor
        var jump = voter()
        XCTAssertEqual(walk(&jump, [p], jumpAt: 5), []) // 2.5 m jump (and moving away): spoiled
        var late = voter() // pin first seen at 5 m: no full approach
        XCTAssertEqual(walk(&late, [p], start: 5), [])
        var quick = voter() // 8, 4.5, 1 m: only 3 samples and 3.5 m jumps
        XCTAssertEqual(walk(&quick, [p], start: 8, stepM: 3.5), [])
        var wide = voter() // pin 0.8 m to the side: beyond lane half-width + 0.3 m
        XCTAssertEqual(walk(&wide, [pin("w", 0.8, 90)]), [])
        var near = voter() // 0.5 m to the side is inside
        XCTAssertEqual(walk(&near, [pin("n", 0.5, 90)]), ["n"])
        var own = voter()
        own.own.insert("p")
        XCTAssertEqual(walk(&own, [p]), [])
        var sample = voter()
        XCTAssertEqual(walk(&sample, [pin("s", 0, 0, sample: true)]), [])
    }

    func testPassiveDownvoteSightingRing() {
        let p = pin("p", 0, 0)
        // Ground confirmed 6 m from the pin 30 s before the walk: seen, no vote (also for a pin fetched later).
        var seen = voter()
        seen.noteConfirmed(bands: ["ground"], walker: Geo.offset(home, east: 0, north: -6), now: 70)
        XCTAssertEqual(walk(&seen, [p]), [])
        // Other band, or older than 60 s, or farther than 10 m: still a vote.
        var otherBand = voter()
        otherBand.noteConfirmed(bands: ["head"], walker: Geo.offset(home, east: 0, north: -6), now: 70)
        XCTAssertEqual(walk(&otherBand, [p]), ["p"])
        var old = voter()
        old.noteConfirmed(bands: ["ground"], walker: home, now: 0)
        XCTAssertEqual(walk(&old, [p], t0: 100), ["p"]) // vote at t 108, sighting 108 s old
        var far = voter()
        far.noteConfirmed(bands: ["ground"], walker: Geo.offset(home, east: 0, north: -12), now: 99)
        XCTAssertEqual(walk(&far, [p]), ["p"])
        // Ring: at most one sighting per band per second, pruned after 60 s.
        var ring = voter()
        for i in 0..<240 { ring.noteConfirmed(bands: ["ground", "head"], walker: home, now: Double(i) * 0.25) }
        XCTAssertLessThanOrEqual(ring.sightings.count, 2 * 61)
        XCTAssertTrue(ring.sightings.allSatisfy { 59.75 - $0.time <= 60 })
    }

    // MARK: Tracking pause debounce

    func testTrackingPauseDebounce() {
        // A single 0.2 s blip: quiet.
        var blip = TrackingDebounce()
        var said = 0
        for i in 0..<30 { let t = Double(i) * 0.05; if blip.step(active: !(t >= 0.1 && t < 0.3), now: t) { said += 1 } }
        XCTAssertEqual(said, 0)
        XCTAssertFalse(blip.episodeOpen) // stable 0.5 s: episode over
        // Flapping 0.2 s lost / 0.2 s normal: never 0.5 s lost in a row, still announced once.
        var flap = TrackingDebounce()
        said = 0
        var firstSaid: Double?
        for i in 0..<60 {
            let t = Double(i) * 0.05
            let lost = Int(t / 0.2) % 2 == 0
            if flap.step(active: !lost, now: t) { said += 1; firstSaid = firstSaid ?? t }
        }
        XCTAssertEqual(said, 1)
        XCTAssertGreaterThanOrEqual(firstSaid ?? 0, Tuning.trackingPauseSeconds)
        // Lost for good: said once at 0.5 s.
        var lost = TrackingDebounce()
        XCTAssertFalse(lost.step(active: false, now: 0))
        XCTAssertFalse(lost.step(active: false, now: 0.4))
        XCTAssertTrue(lost.step(active: false, now: 0.5))
        XCTAssertFalse(lost.step(active: false, now: 2))
    }

    // MARK: Notice queue

    func testNoticeQueueExpiryOrderAndCutRules() {
        var q = NoticeQueue<String>()
        q.push("heads-up", server: true, now: 0)
        q.push("Path guard paused", server: false, now: 0.5)
        XCTAssertNil(q.pop(playing: 3, now: 1)) // never over an alert
        XCTAssertNil(q.pop(playing: AlertPolicy.onRequestPriority, now: 1)) // never over another notice
        XCTAssertEqual(q.pop(playing: nil, now: 1), "Path guard paused") // status first
        XCTAssertEqual(q.pop(playing: nil, now: 1.2), "heads-up")
        // Status may cut off a playing server phrase; a server phrase may not.
        q.push("label", server: true, now: 2)
        XCTAssertNil(q.pop(playing: AlertPolicy.serverPhrasePriority, now: 2))
        q.push("Alerts on", server: false, now: 2)
        XCTAssertEqual(q.pop(playing: AlertPolicy.serverPhrasePriority, now: 2), "Alerts on")
        // A server phrase waiting more than 3 s is dropped, and the caller is told which one.
        var dropped: [String] = []
        XCTAssertNil(q.pop(playing: nil, now: 2 + Tuning.serverPhraseMaxWaitSeconds + 0.1, dropped: &dropped))
        XCTAssertEqual(dropped, ["label"])
        XCTAssertEqual(q.count, 0)
        q.push("heads-up", server: true, now: 10)
        q.push("status", server: false, now: 10)
        XCTAssertEqual(q.replaceAll(with: "what's ahead", now: 10), ["heads-up", "status"])
    }

    // MARK: Crop box

    func testCropBoxPaddingAndClamp() {
        let size = CGSize(width: 1920, height: 1440)
        let c = CGPoint(x: 150, y: 200)
        XCTAssertEqual(CropMath.box([CGPoint(x: 100, y: 100), CGPoint(x: 200, y: 300)], center: c, imageSize: size),
                       CGRect(x: 80, y: 60, width: 140, height: 280))
        XCTAssertEqual(CropMath.box([CGPoint(x: -50, y: 1300), CGPoint(x: 150, y: 1500)], center: CGPoint(x: 50, y: 1400), imageSize: size),
                       CGRect(x: 0, y: 1260, width: 190, height: 180)) // padded -90...190, 1260...1540, clamped
        XCTAssertNil(CropMath.box([], center: c, imageSize: size))
        XCTAssertNil(CropMath.box([CGPoint(x: -500, y: 10), CGPoint(x: -300, y: 50)], center: c, imageSize: size)) // off image
        XCTAssertEqual(CropMath.around(CGPoint(x: 10, y: 720), imageSize: size), CGRect(x: 0, y: 468, width: 504, height: 504))
        XCTAssertEqual(CropMath.scale(for: CGSize(width: 504, height: 640)), 0.5, accuracy: 1e-9)
    }

    func testCropCappedAt45PercentForHazardAt1m() {
        // Pinhole projection like ARKit's landscape image: 1920x1440, f 1344 (field frame 244's intrinsics).
        let size = CGSize(width: 1920, height: 1440)
        func project(_ p: SIMD3<Float>) -> CGPoint {
            CGPoint(x: 961.2 + 1344 * CGFloat(p.x / -p.z), y: 718.3 - 1344 * CGFloat(p.y / -p.z))
        }
        let t = matrix_identity_float4x4
        for kind in HazardKind.allCases {
            let d = detection(kind, SIMD3(0.2, -0.4, -1), ahead: 1)
            let pts = HazardBox.corners(d, cameraTransform: t).filter { HazardBox.inFront($0, cameraTransform: t) }.map(project)
            let r = try? XCTUnwrap(CropMath.box(pts, center: project(d.point), imageSize: size))
            XCTAssertNotNil(r)
            guard let r else { continue }
            XCTAssertLessThanOrEqual(r.width, 0.45 * size.width, "\(kind)")
            XCTAssertLessThanOrEqual(r.height, 0.45 * size.height, "\(kind)")
            XCTAssertTrue(r.contains(project(d.point)), "crop is centred on the hazard point")
        }
    }

    func testHazardBoxProjectsInFrontOnly() {
        let t = matrix_identity_float4x4 // camera at origin looking north (-z)
        let corners = HazardBox.corners(detection(.headHeight, SIMD3(0, 0, -2)), cameraTransform: t)
        XCTAssertEqual(corners.count, 8)
        XCTAssertTrue(corners.allSatisfy { HazardBox.inFront($0, cameraTransform: t) })
        XCTAssertFalse(HazardBox.inFront(SIMD3(0, 0, 2), cameraTransform: t))
    }

    // MARK: Spoken label, TTS fallback

    func testSpokenLabelKeepsAlertPolicyDistanceAndSide() {
        XCTAssertEqual(Spoken.named("trash bin", detection(.ground, .zero, ahead: 2.2, lateral: -0.5)), "Trash bin, 6 feet, left")
        XCTAssertEqual(Spoken.named("low branch", detection(.headHeight, .zero, ahead: 0.8)), "Low branch, 3 feet, ahead")
    }

    func testTTSFallbackSelection() {
        XCTAssertTrue(TTSChoice.useClip(status: 200, contentType: "audio/mpeg", bytes: 4000, elapsed: 1.2))
        for status in [404, 503, 502, 429, 500] {
            XCTAssertFalse(TTSChoice.useClip(status: status, contentType: "application/json", bytes: 30, elapsed: 0.1))
        }
        XCTAssertFalse(TTSChoice.useClip(status: nil, contentType: nil, bytes: 0, elapsed: 0.5)) // network error
        XCTAssertFalse(TTSChoice.useClip(status: 200, contentType: "audio/mpeg", bytes: 4000, elapsed: 3.2)) // too late
        XCTAssertFalse(TTSChoice.useClip(status: 200, contentType: "text/html", bytes: 4000, elapsed: 0.2))
        XCTAssertFalse(TTSChoice.useClip(status: 200, contentType: "audio/mpeg", bytes: 0, elapsed: 0.2))
        XCTAssertEqual(TTSChoice.lang(["es-US", "en-US"]), "es")
        XCTAssertEqual(TTSChoice.lang(["en-US", "es-US"]), "en")
        XCTAssertEqual(TTSChoice.lang([]), "en")
        XCTAssertNotEqual(TTSChoice.cacheKey(text: "Trash bin", lang: "en"), TTSChoice.cacheKey(text: "Trash bin", lang: "es"))
    }

    // MARK: Taxonomy

    func testTaxonomyDisplayNameWithFallback() {
        let tax = [HazardTypeEntry(id: "trash-bin", en: "trash bin", es: "cubo de basura", category: "moving", defaultHeightBand: "ground"),
                   HazardTypeEntry(id: "low-branch", en: "low branch", es: "rama baja", category: "permanent", defaultHeightBand: "head")]
        XCTAssertEqual(Taxonomy.displayName(type: "trash-bin", label: "trash bin at head height", in: tax, lang: "en"), "Trash bin")
        XCTAssertEqual(Taxonomy.displayName(type: "trash-bin", label: nil, in: tax, lang: "es"), "Cubo de basura")
        // Unknown id (legacy free text): the label, else the id with spaces; no taxonomy loaded: same.
        XCTAssertEqual(Taxonomy.displayName(type: "old thing", label: "old thing", in: tax, lang: "en"), "Old thing")
        XCTAssertEqual(Taxonomy.displayName(type: "open-manhole", label: nil, in: tax, lang: "en"), "Open manhole")
        XCTAssertEqual(Taxonomy.displayName(type: "trash-bin", label: "trash bin", in: nil, lang: "en"), "Trash bin")
        XCTAssertEqual(Taxonomy.search(tax, "RAMA", lang: "es").map(\.id), ["low-branch"])
        XCTAssertEqual(Taxonomy.search(tax, "cubo", lang: "es").map(\.id), ["trash-bin"])
        XCTAssertEqual(Taxonomy.search(tax, " ", lang: "en").count, 2)
        let json = #"[{"id":"cone","en":"traffic cone","es":"cono","category":"temporary","defaultHeightBand":"ground"}]"#
        XCTAssertEqual(try JSONDecoder().decode([HazardTypeEntry].self, from: Data(json.utf8)).first?.name(lang: "en"), "traffic cone")
    }
}
