import Foundation
import HealthKit

/// Reads Apple Health and boils one calendar day down to the same summary row the Cut Log web app uses.
/// Totals use HKStatisticsQuery, so iPhone + Watch duplicates are merged the way the Health app does.
final class HealthReader {
    let store = HKHealthStore()

    static let quantityIDs: [HKQuantityTypeIdentifier] = [
        .stepCount, .activeEnergyBurned, .basalEnergyBurned, .appleExerciseTime, .distanceWalkingRunning,
        .heartRate, .restingHeartRate, .heartRateVariabilitySDNN, .respiratoryRate, .oxygenSaturation,
        .vo2Max, .bodyMass, .bodyFatPercentage, .appleSleepingWristTemperature
    ]

    static var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>(quantityIDs.map { HKQuantityType($0) })
        types.insert(HKCategoryType(.sleepAnalysis))
        types.insert(HKObjectType.workoutType())
        types.insert(HKCharacteristicType(.dateOfBirth))
        return types
    }

    /// Types that wake the app in the background when new data lands.
    static let observedTypes: [HKSampleType] = [
        HKQuantityType(.heartRate), HKQuantityType(.stepCount), HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.heartRateVariabilitySDNN), HKCategoryType(.sleepAnalysis), HKObjectType.workoutType()
    ]

    var available: Bool { HKHealthStore.isHealthDataAvailable() }

    func requestAccess() async throws {
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    // MARK: - Query helpers

    private func stats(_ id: HKQuantityTypeIdentifier, _ start: Date, _ end: Date, _ options: HKStatisticsOptions) async -> HKStatistics? {
        await withCheckedContinuation { (cont: CheckedContinuation<HKStatistics?, Never>) in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
            let query = HKStatisticsQuery(quantityType: HKQuantityType(id), quantitySamplePredicate: predicate, options: options) { _, result, _ in
                cont.resume(returning: result)
            }
            store.execute(query)
        }
    }

    private func samples(_ type: HKSampleType, _ start: Date, _ end: Date, limit: Int = HKObjectQueryNoLimit, newestFirst: Bool = false) async -> [HKSample] {
        await withCheckedContinuation { (cont: CheckedContinuation<[HKSample], Never>) in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: !newestFirst)
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: [sort]) { _, results, _ in
                cont.resume(returning: results ?? [])
            }
            store.execute(query)
        }
    }

    /// Max heart rate from date of birth (Tanaka: 208 - 0.7 x age); 190 if unknown.
    private func maxHeartRate() -> Double {
        if let dob = try? store.dateOfBirthComponents(), let date = Calendar.current.date(from: dob) {
            let age = Date().timeIntervalSince(date) / (365.25 * 86_400)
            if age > 10 && age < 100 { return 208 - 0.7 * age }
        }
        return 190
    }

    static func dayId(_ date: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone.current
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    static func workoutName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .traditionalStrengthTraining: return "Strength training"
        case .functionalStrengthTraining: return "Functional strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .running: return "Run"
        case .walking: return "Walk"
        case .cycling: return "Ride"
        case .soccer: return "Football"
        case .swimming: return "Swim"
        case .coreTraining: return "Core"
        case .elliptical: return "Elliptical"
        case .rowing: return "Row"
        case .boxing: return "Boxing"
        case .mixedCardio: return "Cardio"
        case .yoga: return "Yoga"
        case .crossTraining: return "Cross training"
        case .stairClimbing: return "Stairs"
        case .hiking: return "Hike"
        case .basketball: return "Basketball"
        default: return "Workout"
        }
    }

    // MARK: - One day

    /// Everything for one local calendar day. Keys match the web app (active_kcal, hrv_ms, sleep_h, hr_zones, ...).
    func summary(for dayStart: Date) async -> [String: Any] {
        let cal = Calendar.current
        guard let dayEnd = cal.date(byAdding: .day, value: 1, to: dayStart) else { return [:] }
        let end = min(dayEnd, Date())
        if end <= dayStart { return [:] }
        var h: [String: Any] = [:]
        func put(_ key: String, _ value: Double?, _ decimals: Int = 1) {
            guard let v = value, v.isFinite else { return }
            let m = pow(10.0, Double(decimals))
            h[key] = (v * m).rounded() / m
        }
        let kcal = HKUnit.kilocalorie()
        let bpm = HKUnit.count().unitDivided(by: HKUnit.minute())

        // totals
        let active = await stats(.activeEnergyBurned, dayStart, end, .cumulativeSum)
        put("active_kcal", active?.sumQuantity()?.doubleValue(for: kcal), 0)
        let basal = await stats(.basalEnergyBurned, dayStart, end, .cumulativeSum)
        put("resting_kcal", basal?.sumQuantity()?.doubleValue(for: kcal), 0)
        let steps = await stats(.stepCount, dayStart, end, .cumulativeSum)
        put("steps", steps?.sumQuantity()?.doubleValue(for: HKUnit.count()), 0)
        let exercise = await stats(.appleExerciseTime, dayStart, end, .cumulativeSum)
        put("exercise_min", exercise?.sumQuantity()?.doubleValue(for: HKUnit.minute()), 0)
        let distance = await stats(.distanceWalkingRunning, dayStart, end, .cumulativeSum)
        put("distance_km", distance?.sumQuantity()?.doubleValue(for: HKUnit.meterUnit(with: .kilo)), 2)

        // averages
        let rhr = await stats(.restingHeartRate, dayStart, end, .discreteAverage)
        put("rhr", rhr?.averageQuantity()?.doubleValue(for: bpm))
        let hrv = await stats(.heartRateVariabilitySDNN, dayStart, end, .discreteAverage)
        put("hrv_ms", hrv?.averageQuantity()?.doubleValue(for: HKUnit.secondUnit(with: .milli)))
        let resp = await stats(.respiratoryRate, dayStart, end, .discreteAverage)
        put("resp_rate", resp?.averageQuantity()?.doubleValue(for: bpm))
        let spo2 = await stats(.oxygenSaturation, dayStart, end, .discreteAverage)
        if let v = spo2?.averageQuantity()?.doubleValue(for: HKUnit.percent()) { put("spo2", v * 100) }
        let vo2 = await stats(.vo2Max, dayStart, end, .discreteAverage)
        put("vo2max", vo2?.averageQuantity()?.doubleValue(for: HKUnit(from: "ml/kg*min")))
        let temp = await stats(.appleSleepingWristTemperature, dayStart, end, .discreteAverage)
        put("wrist_temp", temp?.averageQuantity()?.doubleValue(for: HKUnit.degreeCelsius()), 2)
        let hrStats = await stats(.heartRate, dayStart, end, [.discreteAverage, .discreteMax])
        put("hr_avg", hrStats?.averageQuantity()?.doubleValue(for: bpm), 0)
        put("hr_max", hrStats?.maximumQuantity()?.doubleValue(for: bpm), 0)

        // latest weight / body fat of the day
        if let w = await samples(HKQuantityType(.bodyMass), dayStart, end, limit: 1, newestFirst: true).first as? HKQuantitySample {
            put("weight_kg", w.quantity.doubleValue(for: HKUnit.gramUnit(with: .kilo)))
        }
        if let f = await samples(HKQuantityType(.bodyFatPercentage), dayStart, end, limit: 1, newestFirst: true).first as? HKQuantitySample {
            put("body_fat", f.quantity.doubleValue(for: HKUnit.percent()) * 100)
        }

        // heart-rate zones + strain load (Edwards TRIMP) + latest reading
        let hr = await samples(HKQuantityType(.heartRate), dayStart, end).compactMap { $0 as? HKQuantitySample }
        if !hr.isEmpty {
            let maxHR = maxHeartRate()
            var zones = [Double](repeating: 0, count: 5)
            var trimp = 0.0, seconds = 0.0
            for i in 0..<hr.count {
                let value = hr[i].quantity.doubleValue(for: bpm)
                let gap = i + 1 < hr.count ? hr[i + 1].startDate.timeIntervalSince(hr[i].startDate) : 60
                let duration = (gap > 0 && gap <= 600) ? gap : 60   // a long gap (watch off) counts as one minute
                let pct = value / maxHR
                let zone = pct >= 0.9 ? 5 : pct >= 0.8 ? 4 : pct >= 0.7 ? 3 : pct >= 0.6 ? 2 : pct >= 0.5 ? 1 : 0
                if zone > 0 {
                    zones[zone - 1] += duration / 60
                    trimp += duration / 60 * Double(zone)
                }
                seconds += duration
            }
            h["hr_zones"] = zones.map { Int($0.rounded()) }
            put("trimp", trimp, 0)
            put("hr_minutes", seconds / 60, 0)
            if let last = hr.last {
                put("hr_latest", last.quantity.doubleValue(for: bpm), 0)
                h["hr_latest_ms"] = Int(last.endDate.timeIntervalSince1970 * 1000)
            }
        }

        // workouts that started this day
        let workouts = await samples(HKObjectType.workoutType(), dayStart, end).compactMap { $0 as? HKWorkout }.filter { $0.startDate >= dayStart }
        if !workouts.isEmpty {
            let tf = DateFormatter()
            tf.dateFormat = "HH:mm"
            var list: [[String: Any]] = []
            var minutes = 0.0, energy = 0.0
            var types: [String] = []
            for w in workouts {
                let m = w.duration / 60
                minutes += m
                var item: [String: Any] = ["t": Self.workoutName(w.workoutActivityType), "s": tf.string(from: w.startDate), "e": tf.string(from: w.endDate), "min": Int(m.rounded())]
                if let k = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: kcal) {
                    energy += k
                    item["kcal"] = Int(k.rounded())
                }
                if list.count < 8 { list.append(item) }
                types.append(Self.workoutName(w.workoutActivityType))
            }
            h["workouts"] = workouts.count
            put("workout_min", minutes, 0)
            if energy > 0 { put("workout_kcal", energy, 0) }
            h["workout_list"] = list
            h["workout_types"] = Array(Set(types)).joined(separator: ",")
        }

        // sleep: the night that ended this morning (18:00 the evening before until 14:00)
        if let nightStart = cal.date(byAdding: .hour, value: -6, to: dayStart), let nightEnd = cal.date(byAdding: .hour, value: 14, to: dayStart) {
            let sleep = await samples(HKCategoryType(.sleepAnalysis), nightStart, min(nightEnd, Date())).compactMap { $0 as? HKCategorySample }
            struct Acc { var deep = 0.0, rem = 0.0, core = 0.0, asleep = 0.0, awake = 0.0, start = Date.distantFuture, end = Date.distantPast }
            var bySource: [String: Acc] = [:]
            for s in sleep {
                guard let value = HKCategoryValueSleepAnalysis(rawValue: s.value) else { continue }
                let duration = s.endDate.timeIntervalSince(s.startDate)
                guard duration > 0, duration < 16 * 3600 else { continue }
                let source = s.sourceRevision.source.bundleIdentifier
                var a = bySource[source] ?? Acc()
                switch value {
                case .asleepDeep: a.deep += duration
                case .asleepREM: a.rem += duration
                case .asleepCore: a.core += duration
                case .asleepUnspecified: a.asleep += duration
                case .awake: a.awake += duration
                default: break
                }
                if value != .inBed && value != .awake {
                    a.start = min(a.start, s.startDate)
                    a.end = max(a.end, s.endDate)
                }
                bySource[source] = a
            }
            // prefer the source that records stages (the Watch), then the longest
            let best = bySource.values.max { a, b in
                let sa = (a.deep + a.rem + a.core) > 0 ? 1 : 0, sb = (b.deep + b.rem + b.core) > 0 ? 1 : 0
                if sa != sb { return sa < sb }
                return (a.deep + a.rem + a.core + a.asleep) < (b.deep + b.rem + b.core + b.asleep)
            }
            if let b = best, b.end > dayStart {
                let total = b.deep + b.rem + b.core + b.asleep
                if total > 1800 {
                    put("sleep_h", total / 3600, 2)
                    if b.deep + b.rem + b.core > 0 {
                        put("sleep_deep_h", b.deep / 3600, 2)
                        put("sleep_rem_h", b.rem / 3600, 2)
                        put("sleep_core_h", (b.core + b.asleep) / 3600, 2)
                    }
                    if b.awake > 0 { put("sleep_awake_h", b.awake / 3600, 2) }
                    h["bed_ms"] = Int(b.start.timeIntervalSince1970 * 1000)
                    h["wake_ms"] = Int(b.end.timeIntervalSince1970 * 1000)
                }
            }
        }
        return h
    }
}
