import SwiftUI

private let orange = Color(red: 1.0, green: 0.42, blue: 0.21)
private let blue = Color(red: 0.24, green: 0.55, blue: 1.0)
private let green = Color(red: 0.13, green: 0.77, blue: 0.37)
private let surface = Color(red: 0.067, green: 0.075, blue: 0.09)
private let surface2 = Color(red: 0.106, green: 0.118, blue: 0.141)
private let muted = Color(red: 0.64, green: 0.67, blue: 0.71)
private let webApp = URL(string: "https://mamourmedia01.github.io/CUT/#body")!

struct ContentView: View {
    @EnvironmentObject var e: SyncEngine

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if e.config == nil { notConnected } else { connected }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
        }
        .background(Color.black.ignoresSafeArea())
    }

    private var header: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 8).fill(orange).frame(width: 30, height: 30)
                .overlay(Image(systemName: "waveform.path.ecg").font(.system(size: 15, weight: .bold)).foregroundColor(.black))
            Text("CUT LOG SYNC").font(.system(size: 22, weight: .heavy, design: .default)).tracking(0.5)
            Spacer()
            if e.config != nil {
                Circle().fill(e.lastResult.hasPrefix("Couldn") ? Color.red : green).frame(width: 9, height: 9)
                    .accessibilityLabel(e.lastResult.isEmpty ? "Connected" : e.lastResult)
            }
        }
        .padding(.bottom, 4)
    }

    // MARK: not connected yet

    private var notConnected: some View {
        VStack(alignment: .leading, spacing: 14) {
            card {
                Text("Connect to Cut Log").font(.title3.weight(.bold))
                Text("Open Cut Log, go to Settings → Apple Watch and tap Connect iPhone app. It fills everything in here and asks Apple Health for access. Nothing to copy or paste.")
                    .foregroundColor(muted)
                Link(destination: URL(string: "https://mamourmedia01.github.io/CUT/#settings")!) {
                    Text("Open Cut Log").bold().frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(orange).foregroundColor(.black).clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
            if !e.lastResult.isEmpty { Text(e.lastResult).font(.footnote).foregroundColor(muted) }
        }
    }

    // MARK: connected

    private var connected: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !e.healthAsked {
                card {
                    Text("Allow Apple Health").font(.title3.weight(.bold))
                    Text("Tap below, then Turn On All and Allow. Cut Log Sync only reads; it never changes your Health data.").foregroundColor(muted)
                    Button { Task { await e.connectFlow() } } label: {
                        Text("Allow Apple Health").bold().frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(orange).foregroundColor(.black).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }

            // live heart rate
            card {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today").font(.headline)
                    Spacer()
                    if let ms = e.number("hr_latest_ms") {
                        Text(Date(timeIntervalSince1970: ms / 1000), style: .relative).font(.footnote).foregroundColor(muted)
                        + Text(" ago").font(.footnote).foregroundColor(muted)
                    }
                }
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Image(systemName: "heart.fill").foregroundColor(orange).font(.title2)
                    Text(e.number("hr_latest").map { String(Int($0)) } ?? "–").font(.system(size: 54, weight: .heavy)).monospacedDigit()
                    Text("bpm").foregroundColor(muted)
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    tile("Steps", e.number("steps"), "")
                    tile("Active", e.number("active_kcal"), "kcal")
                    tile("Exercise", e.number("exercise_min"), "min")
                    tile("HRV", e.number("hrv_ms"), "ms")
                    tile("Resting HR", e.number("rhr"), "bpm")
                    tile("Sleep", e.number("sleep_h"), "h", decimals: 1)
                }
            }

            // status
            card {
                row("Apple Health", e.healthAsked ? "Allowed" : "Not yet")
                row("Background updates", e.backgroundOn ? "On" : "When the app opens")
                HStack {
                    Text("Last sent").foregroundColor(muted)
                    Spacer()
                    if let d = e.lastSync { Text(d, style: .relative).monospacedDigit() + Text(" ago") } else { Text("Not yet") }
                }
                if !e.lastResult.isEmpty { Text(e.lastResult).font(.footnote).foregroundColor(e.lastResult.hasPrefix("Couldn") ? .red : muted) }
                HStack(spacing: 10) {
                    Button { Task { await e.sync(days: 2, reason: "sync now") } } label: {
                        Text(e.busy ? "Sending…" : "Sync now").bold().frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(orange).foregroundColor(.black).clipShape(RoundedRectangle(cornerRadius: 12))
                    }.disabled(e.busy)
                    Link(destination: webApp) {
                        Text("Open Cut Log").bold().frame(maxWidth: .infinity).padding(.vertical, 12)
                            .background(surface2).foregroundColor(.white).clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
                Button { Task { await e.sync(days: 120, reason: "history") } } label: {
                    Text("Send the last 120 days").font(.subheadline).foregroundColor(blue)
                }.disabled(e.busy)
            }

            if !e.activity.isEmpty {
                card {
                    Text("Activity").font(.headline)
                    ForEach(e.activity, id: \.self) { Text($0).font(.footnote.monospacedDigit()).foregroundColor(muted) }
                }
            }

            Button(role: .destructive) { e.disconnect() } label: { Text("Disconnect").font(.footnote) }
                .padding(.top, 4)
        }
    }

    // MARK: pieces

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(surface)
            .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func tile(_ label: String, _ value: Double?, _ unit: String, decimals: Int = 0) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundColor(muted)
            HStack(alignment: .lastTextBaseline, spacing: 3) {
                Text(value.map { decimals > 0 ? String(format: "%.\(decimals)f", $0) : Int($0).formatted() } ?? "–")
                    .font(.system(size: 24, weight: .bold)).monospacedDigit()
                if !unit.isEmpty { Text(unit).font(.caption).foregroundColor(muted) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(surface2)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack { Text(label).foregroundColor(muted); Spacer(); Text(value) }
    }
}
