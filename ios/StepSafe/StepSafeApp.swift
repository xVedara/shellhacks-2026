import SwiftUI

@main
struct StepSafeApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .onAppear { Palette.applyChrome() }
        }
    }
}
