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

    /// Siri shows and speaks the answer as a dialog too, so it is heard even if StepSafe's own audio is interrupted.
    /// Stopped, tracking lost or stale: the dialog says StepSafe is not checking the path (AlertManager).
    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: AppModel.shared.alerts.whatsAheadForShortcut()))
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
