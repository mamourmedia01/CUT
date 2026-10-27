import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        BackgroundSync.register()
        // Background delivery only works if the observer queries are set up at every launch.
        Task { @MainActor in SyncEngine.shared.startObservers() }
        return true
    }
}

@main
struct CutLogSyncApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var engine = SyncEngine.shared
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(engine)
                .onOpenURL { engine.handle(url: $0) }
                .preferredColorScheme(.dark)
        }
        .onChange(of: phase) { _, newPhase in
            if newPhase == .active {
                engine.startObservers()
                engine.startLive()
            } else if newPhase == .background {
                engine.stopLive()
                BackgroundSync.schedule()
            }
        }
    }
}
