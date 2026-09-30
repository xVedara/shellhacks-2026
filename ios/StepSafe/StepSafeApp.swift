import SwiftUI

@main
struct StepSafeApp: App {
    @ObservedObject private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .onAppear { Palette.applyChrome() }
        }
    }
}
