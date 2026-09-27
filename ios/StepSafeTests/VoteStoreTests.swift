import XCTest

/// Community and Scout share one vote record: a vote from either tab is seen by the other and survives its saves.
final class VoteStoreTests: XCTestCase {
    private var suite: String!
    private var defaults: UserDefaults!

    override func setUp() {
        suite = "VoteStoreTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suite)
    }

    override func tearDown() { defaults.removePersistentDomain(forName: suite) }

    func testVoteInOneTabIsSeenAndKeptByTheOther() {
        // Even as two separate objects (the app uses one shared store), neither can hide or erase the other's votes.
        let scout = VoteStore(defaults: defaults), community = VoteStore(defaults: defaults)
        XCTAssertNil(community.vote("a"))

        scout.record("a", up: true)
        XCTAssertEqual(community.vote("a"), "up") // Community must not offer a second vote

        community.record("b", up: false) // Community's save keeps Scout's vote
        XCTAssertEqual(scout.vote("a"), "up")
        XCTAssertEqual(scout.vote("b"), "down")
        XCTAssertEqual(VoteStore(defaults: defaults).vote("a"), "up") // persisted
    }
}
