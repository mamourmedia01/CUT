import Foundation
import HealthKit
import UIKit
import BackgroundTasks

struct SyncConfig: Codable, Equatable {
    var pushURL: String   // https://<project>.supabase.co/functions/v1/cut?action=push&k=<personal key>
    var apiKey: String    // the project's public anon key (needed by the function gateway)
}

/// Connects to Cut Log, reads Apple Health and sends it. Runs live while open, and wakes in the
/// background whenever the Watch delivers new heart rate, steps, calories, HRV, sleep or a workout.
@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()

    @Published var config: SyncConfig? = SyncEngine.loadConfig()
    @Published var healthAsked = UserDefaults.standard.bool(forKey: "healthAsked")
    @Published var today: [String: Any] = [:]
    @Published var lastSync: Date? = UserDefaults.standard.object(forKey: "lastSync") as? Date
    @Published var lastResult = ""
    @Published var busy = false
    @Published var backgroundOn = false
    @Published var activity: [String] = []

    let reader = HealthReader()
    private var observersStarted = false
    private var liveTask: Task<Void, Never>?

    // MARK: - Config

    private static func loadConfig() -> SyncConfig? {
        guard let data = UserDefaults.standard.data(forKey: "config") else { return nil }
        return try? JSONDecoder().decode(SyncConfig.self, from: data)
    }

    private func saveConfig(_ c: SyncConfig?) {
        config = c
        if let c, let data = try? JSONEncoder().encode(c) {
            UserDefaults.standard.set(data, forKey: "config")
        } else {
            UserDefaults.standard.removeObject(forKey: "config")
        }
    }

    func disconnect() {
        stopLive()
        saveConfig(nil)
        note("Disconnected")
    }

    /// cutlogsync://setup?u=<push url>&a=<anon key>  (opened by the Connect button in Cut Log)
    func handle(url: URL) {
        guard url.scheme == "cutlogsync", let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        var items: [String: String] = [:]
        for item in comps.queryItems ?? [] { if let v = item.value { items[item.name] = v } }
        guard let u = items["u"], let a = items["a"], u.hasPrefix("https://"), !a.isEmpty else {
            lastResult = "That link was incomplete. Tap Connect iPhone app in Cut Log again."
            return
        }
        saveConfig(SyncConfig(pushURL: u, apiKey: a))
        note("Connected to Cut Log")
        Task { await connectFlow() }
    }

    func connectFlow() async {
        await requestHealth()
        await sync(days: 30, reason: "first sync")
        startObservers()
        startLive()
    }

    func requestHealth() async {
        guard reader.available else { lastResult = "Apple Health isn't available on this device."; return }
        do {
            try await reader.requestAccess()
            healthAsked = true
            UserDefaults.standard.set(true, forKey: "healthAsked")
        } catch {
            lastResult = "Apple Health access failed: \(error.localizedDescription)"
            note(lastResult)
        }
    }

    // MARK: - Sync

    func sync(days: Int, reason: String) async {
        guard let c = config, !busy else { return }
        busy = true
        defer { busy = false }
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        var rows: [[String: Any]] = []
        for i in 0..<max(1, days) {
            guard let d = cal.date(byAdding: .day, value: -i, to: start) else { continue }
            let h = await reader.summary(for: d)
            if i == 0 { today = h }
            if !h.isEmpty { rows.append(["day": HealthReader.dayId(d), "health": h]) }
        }
        if rows.isEmpty { lastResult = "No Apple Health data yet. Check access in Settings → Health → Data Access & Devices."; return }
        do {
            var sent = 0
            var i = 0
            while i < rows.count {
                let chunk = Array(rows[i..<min(i + 60, rows.count)])
                sent += try await upload(chunk, config: c)
                i += 60
            }
            let now = Date()
            lastSync = now
            UserDefaults.standard.set(now, forKey: "lastSync")
            lastResult = "Sent \(sent) day\(sent == 1 ? "" : "s")"
        } catch {
            lastResult = "Couldn't send: \(error.localizedDescription)"
        }
        if reason != "live" { note("\(reason.capitalized): \(lastResult)") }
    }

    private func upload(_ rows: [[String: Any]], config c: SyncConfig) async throws -> Int {
        guard let url = URL(string: c.pushURL) else { throw URLError(.badURL) }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(c.apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue(c.apiKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["rows": rows, "tz": TimeZone.current.identifier])
        let (data, response) = try await URLSession.shared.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let msg = code == 401 ? "the link isn't valid any more. Tap Connect iPhone app in Cut Log again." : "the server said \(code)"
            throw NSError(domain: "CutLogSync", code: code, userInfo: [NSLocalizedDescriptionKey: msg])
        }
        let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return obj?["days"] as? Int ?? rows.count
    }

    // MARK: - Background: wake when the Watch delivers new data

    func startObservers() {
        guard config != nil, !observersStarted, reader.available, healthAsked else { return }
        observersStarted = true
        for type in HealthReader.observedTypes {
            reader.store.enableBackgroundDelivery(for: type, frequency: .immediate) { ok, _ in
                if ok { Task { @MainActor in SyncEngine.shared.backgroundOn = true } }
            }
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, done, error in
                if error != nil { done(); return }
                Task { @MainActor in
                    let id = UIApplication.shared.beginBackgroundTask(withName: "cutlog-sync", expirationHandler: nil)
                    await SyncEngine.shared.sync(days: 2, reason: "background")
                    UIApplication.shared.endBackgroundTask(id)
                    done()
                }
            }
            reader.store.execute(query)
        }
    }

    // MARK: - Live: refresh every 30 s while the app is open, send every minute

    func startLive() {
        guard config != nil else { return }
        liveTask?.cancel()
        liveTask = Task { @MainActor in
            var tick = 0
            while !Task.isCancelled {
                if tick % 2 == 0 {
                    await self.sync(days: 1, reason: "live")
                } else {
                    self.today = await self.reader.summary(for: Calendar.current.startOfDay(for: Date()))
                }
                tick += 1
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }

    func stopLive() {
        liveTask?.cancel()
        liveTask = nil
    }

    func note(_ line: String) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        activity.insert("\(f.string(from: Date()))  \(line)", at: 0)
        if activity.count > 30 { activity.removeLast(activity.count - 30) }
    }

    func number(_ key: String) -> Double? {
        if let d = today[key] as? Double { return d }
        if let i = today[key] as? Int { return Double(i) }
        return nil
    }
}

/// Periodic background refresh (iOS decides exactly when; usually every hour or so).
enum BackgroundSync {
    static let id = "com.mamourmedia.cutlogsync.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
            schedule()
            let work = Task { @MainActor in
                await SyncEngine.shared.sync(days: 2, reason: "refresh")
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: id)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
