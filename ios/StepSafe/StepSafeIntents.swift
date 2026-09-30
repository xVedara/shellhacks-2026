import AppIntents

/// Hands-free start and "what's ahead" from Siri, Spotlight, the Action Button and Back Tap (App Shortcuts need
/// no setup). Both act on AppModel.shared, the model the app scene shows.

struct StartWalkingIntent: AppIntent {
    static let title: LocalizedStringResource = "Start StepSafe"
    static let description = IntentDescription("Starts scanning the path ahead on the Walker screen.")
    /// The camera and LiDAR run only in the foreground.
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let model = AppModel.shared
        if !model.running, SensorSession.isSupported { model.toggleRunning() }
        return .result()
    }
}

struct WhatsAheadIntent: AppIntent {
    static let title: LocalizedStringResource = "What's ahead"
    static let description = IntentDescription("Speaks the nearest hazard StepSafe detects, like one AirPods press.")

    /// Live: the answer plays only through StepSafe's own interruptible audio (a hazard alert may cut it off), and
    /// Siri says nothing, so the two never talk over each other or over an alert. Stopped, paused, stale or in the
    /// background: nothing plays, and Siri says StepSafe is not checking the path (thrown as the intent's error).
    @MainActor
    func perform() async throws -> some IntentResult {
        if let notChecking = AppModel.shared.alerts.whatsAheadForShortcut() { throw NotChecking(text: notChecking) }
        return .result()
    }

    struct NotChecking: Error, CustomLocalizedStringResourceConvertible {
        let text: String
        var localizedStringResource: LocalizedStringResource { "\(text)" }
    }
}

struct StepSafeShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartWalkingIntent(),
                    phrases: ["Start \(.applicationName)", "Start walking with \(.applicationName)"],
                    shortTitle: "Start", systemImageName: "figure.walk")
        AppShortcut(intent: WhatsAheadIntent(),
                    phrases: ["What's ahead in \(.applicationName)", "\(.applicationName) what's ahead"],
                    shortTitle: "What's ahead", systemImageName: "ear")
    }
}
