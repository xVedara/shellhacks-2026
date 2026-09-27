import XCTest

final class CommunityTests: XCTestCase {
    let home = Geo.Fix(lat: 25.7562, lng: -80.3739)

    /// Shaped from a real GET /hazards/:id answer (server/src/app.ts), with measurements, a crop and a pending reclassify.
    let detailJSON = """
    {"id":"6ab7f18296b21a00643c0727","type":"e-scooter","category":"moving","lat":25.756824577793747,
     "lng":-80.37350103792531,"heightBand":"ground","confidence":3,"lastSeen":"2026-09-26T16:23:30.088Z",
     "status":"active","label":"e-scooter","sample":true,"measurements":{"clearanceM":1.9},"crop":"/9j/4AAQ",
     "meshUrl":null,"spokenLabel_es":"patinete eléctrico","severity":2,"createdAt":"2026-09-26T15:23:30.088Z",
     "expiresAt":"2026-10-26T16:23:30.088Z",
     "votes":[{"deviceId":"b5460e8cee","vote":"up","source":"scout","weight":1,"at":"2026-09-26T16:23:30.088Z"},
              {"deviceId":"36a50fd209","vote":"down","source":"walker","weight":0.6,"at":"2026-09-26T16:25:00.000Z"}],
     "pendingReclassifications":[{"type":"trash-bin","heightBand":"ground","count":2}]}
    """

    func testDetailDecodes() throws {
        let d = try JSONDecoder().decode(HazardDetail.self, from: Data(detailJSON.utf8))
        XCTAssertEqual(d.id, "6ab7f18296b21a00643c0727")
        XCTAssertEqual(d.spokenLabel_es, "patinete eléctrico")
        XCTAssertEqual(d.measurements?.clearanceM, 1.9)
        XCTAssertNil(d.measurements?.widthM)
        XCTAssertEqual(d.severity, 2)
        XCTAssertEqual(d.ups, 1)
        XCTAssertEqual(d.downs, 1)
        XCTAssertEqual(d.votes[1].weight, 0.6)
        XCTAssertEqual(d.pendingReclassifications, [PendingReclass(type: "trash-bin", category: nil, heightBand: "ground", count: 2)])
        XCTAssertNotNil(Community.date(d.lastSeen))
        // No photo and no measurements (sample pins) also decode.
        let bare = detailJSON.replacingOccurrences(of: "{\"clearanceM\":1.9}", with: "null")
            .replacingOccurrences(of: "\"/9j/4AAQ\"", with: "null")
        XCTAssertNil(try JSONDecoder().decode(HazardDetail.self, from: Data(bare.utf8)).measurements)
    }

    func testNearRowKeepsLastSeen() throws {
        let row = try JSONDecoder().decode(NearHazard.self, from: Data("""
        {"id":"a","type":"umbrella","category":"moving","lat":25.75,"lng":-80.37,"heightBand":"head","confidence":1,
         "lastSeen":"2026-09-26T15:43:30.088Z","status":"active","label":"umbrella at head height","sample":true,"distanceM":120.1}
        """.utf8))
        XCTAssertEqual(row.lastSeen, "2026-09-26T15:43:30.088Z")
    }

    func testClockBearing() {
        XCTAssertEqual(Community.clock(bearing: 0, heading: 0), 12)
        XCTAssertEqual(Community.clock(bearing: 60, heading: 0), 2)
        XCTAssertEqual(Community.clock(bearing: 90, heading: 0), 3)
        XCTAssertEqual(Community.clock(bearing: 180, heading: 0), 6)
        XCTAssertEqual(Community.clock(bearing: 10, heading: 40), 11) // 30 degrees left
        XCTAssertEqual(Community.clock(bearing: 350, heading: 5), 12) // wraps through north
        XCTAssertEqual(Community.direction(bearing: 60, heading: 0), "2 o'clock")
        XCTAssertEqual(Community.direction(bearing: 60, heading: 0, lang: "es"), "a las 2")
        // No heading: compass point.
        XCTAssertEqual(Community.direction(bearing: 44, heading: nil), "northeast")
        XCTAssertEqual(Community.direction(bearing: 350, heading: nil), "north")
        XCTAssertEqual(Community.direction(bearing: 180, heading: nil, lang: "es"), "sur")
    }

    func testOneMileVoteGate() {
        XCTAssertTrue(Community.canVote(distanceM: 1609))
        XCTAssertFalse(Community.canVote(distanceM: 1610))
        let north = { (m: Double) in Geo.offset(self.home, east: 0, north: m) }
        XCTAssertTrue(Community.canVote(from: home, accuracyM: 10, ageS: 1, to: north(1608.9)))
        XCTAssertFalse(Community.canVote(from: home, accuracyM: 10, ageS: 1, to: north(1610.1)))
        XCTAssertFalse(Community.canVote(from: nil, accuracyM: 10, ageS: 1, to: home)) // no GPS, no vote
    }

    func testVoteGateBlocksInaccurateFix() {
        XCTAssertTrue(Community.canVote(from: home, accuracyM: 100, ageS: 1, to: home))
        XCTAssertFalse(Community.canVote(from: home, accuracyM: 101, ageS: 1, to: home))
        XCTAssertFalse(Community.canVote(from: home, accuracyM: -1, ageS: 1, to: home)) // invalid fix
    }

    func testVoteGateBlocksStaleFix() {
        XCTAssertTrue(Community.canVote(from: home, accuracyM: 10, ageS: 30, to: home))
        XCTAssertFalse(Community.canVote(from: home, accuracyM: 10, ageS: 31, to: home))
    }

    func testAnnounceOnlyFreshHazards() {
        let now = Community.date("2026-09-26T16:05:00.000Z")!
        XCTAssertTrue(Community.isFresh(lastSeen: "2026-09-26T16:03:30.088Z", now: now))
        XCTAssertFalse(Community.isFresh(lastSeen: "2026-09-26T16:02:59.000Z", now: now))
        XCTAssertFalse(Community.isFresh(lastSeen: nil, now: now))
    }

    func testImperialDistances() {
        XCTAssertEqual(Community.distance(12.192), "40 feet")
        XCTAssertEqual(Community.distance(0.3), "1 foot")
        XCTAssertEqual(Community.distance(1.9), "6 feet") // a clearance: to the foot
        XCTAssertEqual(Community.distance(20), "65 feet") // 66 ft: to 5 from 50 ft up
        XCTAssertEqual(Community.distance(150), "490 feet") // 492 ft, under 0.1 mi (528 ft)
        XCTAssertEqual(Community.distance(170), "0.1 miles")
        XCTAssertEqual(Community.distance(500), "0.3 miles")
        XCTAssertEqual(Community.distance(1609), "1.0 mile")
        XCTAssertEqual(Community.distance(12.192, lang: "es"), "40 pies")
        XCTAssertEqual(Community.distance(500, lang: "es"), "0.3 millas")
    }

    func testRowLabelIsImperialAndReadable() {
        let pin = Geo.offset(home, east: 12.192 * sin(.pi / 3), north: 12.192 * cos(.pi / 3)) // 40 ft at bearing 60
        XCTAssertEqual(Community.rowLabel(name: "Low branch", sample: true, confidence: 3, walker: home, pin: pin,
                                          distanceM: nil, heading: 0),
                       "Sample. Low branch, 40 feet, 2 o'clock, confidence 3")
        XCTAssertEqual(Community.rowLabel(name: "Rama baja", sample: false, confidence: 1.5, walker: nil, pin: pin,
                                          distanceM: 500, heading: nil, lang: "es"),
                       "Rama baja, 0.3 millas, confianza 1.5")
        for lang in ["en", "es"] {
            let s = Community.rowLabel(name: "X", sample: false, confidence: 1, walker: home, pin: pin, distanceM: nil,
                                       heading: nil, lang: lang)
            XCTAssertFalse(s.contains(" m,") || s.contains("metre") || s.contains("meter") || s.contains("metro"))
        }
    }

    func testSSEParser() {
        var p = Community.SSEParser()
        let upsert = #"data: {"op":"upsert","hazard":{"id":"a","type":"trash-bin","category":"moving","lat":25.75,"lng":-80.37,"heightBand":"ground","confidence":1,"lastSeen":"2026-09-26T16:03:30.088Z","status":"active","label":"trash bin","sample":false}}"#
        XCTAssertNil(p.feed("retry: 3000"))
        XCTAssertNil(p.feed(""))
        XCTAssertNil(p.feed(": ping"))
        XCTAssertNil(p.feed("event: hazard"))
        guard case .upsert(let h)? = p.feed(upsert) else { return XCTFail("no upsert") }
        XCTAssertEqual(h.id, "a")
        XCTAssertEqual(h.lastSeen, "2026-09-26T16:03:30.088Z")
        XCTAssertNil(p.feed("")) // blank line (AsyncLineSequence may drop it; parsing does not depend on it)
        XCTAssertNil(p.feed("event: hazard"))
        XCTAssertEqual(p.feed(#"data: {"op":"remove","id":"b"}"#), .remove("b"))
        // Other event names and junk are ignored.
        XCTAssertNil(p.feed("event: other"))
        XCTAssertNil(p.feed(#"data: {"op":"remove","id":"c"}"#))
        XCTAssertNil(p.feed("event: hazard"))
        XCTAssertNil(p.feed("data: not json"))
        XCTAssertNil(p.feed(#"data: {"op":"upsert"}"#))
    }

    func testBandNames() {
        XCTAssertEqual(Community.band("ground"), "Ground")
        XCTAssertEqual(Community.band("head"), "Head height")
        XCTAssertEqual(Community.band("dropoff", lang: "es"), "Desnivel")
        XCTAssertEqual(Community.band("overhead"), "Unknown height") // never falls back to "Ground"
    }
}
