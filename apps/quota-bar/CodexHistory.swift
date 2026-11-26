import Foundation

enum CodexHistory {
    private static let window: TimeInterval = 24 * 60 * 60
    private static let maxFiles = 32
    private static let maxBytesPerFile = 2 * 1024 * 1024
    private static let maxPoints = 200

    private struct Key: Hashable {
        let limit: String
        let slot: String
        let duration: Int
        let reset: Int64
    }

    static var sessions: URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let configured = ProcessInfo.processInfo.environment["CODEX_HOME"]
        let codexHome = configured.flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil }
            ?? home.appendingPathComponent(".codex", isDirectory: true)
        return codexHome.appendingPathComponent("sessions", isDirectory: true)
    }

    static func restore(_ live: Data, from root: URL = sessions) throws -> (data: Data, count: Int)? {
        guard var snapshot = try JSONSerialization.jsonObject(with: live) as? [String: Any],
              let pools = snapshot["pools"] as? [[String: Any]] else { return nil }
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func date(_ input: Any?) -> Date? {
            guard let text = input as? String else { return nil }
            return fractional.date(from: text) ?? plain.date(from: text)
        }

        var windows: [Key: (index: Int, start: Date, latest: Date)] = [:]
        for (index, pool) in pools.enumerated() {
            guard pool["sourceId"] as? String == CodexQuota.sourceID, pool["unit"] as? String == "percent",
                  let id = pool["poolId"] as? String,
                  let slot = ["primary", "secondary"].first(where: { id.hasSuffix("-" + $0) }),
                  let start = date(pool["cycleStart"]), let reset = date(pool["resetsAt"]),
                  let observations = pool["observations"] as? [[String: Any]],
                  let latest = date(observations.last?["observedAt"]),
                  start <= latest, latest < reset,
                  let duration = Int(exactly: reset.timeIntervalSince(start) / 60), duration > 0,
                  let epoch = Int64(exactly: reset.timeIntervalSince1970) else { continue }
            let key = Key(limit: String(id.dropLast(slot.count + 1)), slot: slot, duration: duration, reset: epoch)
            windows[key] = (index, start, latest)
        }
        guard let latest = windows.values.map(\.latest).max() else { return nil }
        let earliest = latest.addingTimeInterval(-window)
        let marker = Data("\"token_count\"".utf8)
        var points: [Key: [Date: Double]] = [:]
        var conflicts: [Key: Set<Date>] = [:]
        for file in recentFiles(root, latest: latest) {
            guard let data = tail(file) else { continue }
            for line in data.split(separator: 10) where line.range(of: marker) != nil {
                guard let record = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                      record["type"] as? String == "event_msg",
                      let timestamp = date(record["timestamp"]), timestamp >= earliest,
                      let payload = record["payload"] as? [String: Any], payload["type"] as? String == "token_count",
                      let limits = payload["rate_limits"] as? [String: Any], let limit = limits["limit_id"] as? String else { continue }
                for slot in ["primary", "secondary"] {
                    guard let reading = limits[slot] as? [String: Any],
                          let duration = reading["window_minutes"] as? Int, let reset = reading["resets_at"] as? Int64,
                          let used = reading["used_percent"] as? Double, used.isFinite, (0...100).contains(used) else { continue }
                    let key = Key(limit: limit, slot: slot, duration: duration, reset: reset)
                    guard let target = windows[key], timestamp >= target.start, timestamp < target.latest else { continue }
                    let rounded = Date(timeIntervalSince1970: floor(timestamp.timeIntervalSince1970 * 1000) / 1000)
                    if let previous = points[key]?[rounded], previous != used {
                        conflicts[key, default: []].insert(rounded)
                    } else {
                        points[key, default: [:]][rounded] = used
                    }
                }
            }
        }

        var restored: [[String: Any]] = []
        var count = 0
        for (key, target) in windows.sorted(by: { $0.value.index < $1.value.index }) {
            let rows = points[key, default: [:]].filter { !conflicts[key, default: []].contains($0.key) }
                .sorted { $0.key < $1.key }.suffix(maxPoints)
            if rows.isEmpty { continue }
            var pool = pools[target.index]
            pool["observations"] = rows.map { timestamp, used in
                ["observedAt": fractional.string(from: timestamp), "remaining": 100 - used]
            }
            count += rows.count
            restored.append(pool)
        }
        guard count > 0 else { return nil }
        snapshot["pools"] = restored
        return (try JSONSerialization.data(withJSONObject: snapshot), count)
    }

    private static func recentFiles(_ root: URL, latest: Date) -> [URL] {
        let calendar = Calendar.current
        let path = DateFormatter()
        path.calendar = Calendar(identifier: .gregorian)
        path.locale = Locale(identifier: "en_US_POSIX")
        path.dateFormat = "yyyy/MM/dd"
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .contentModificationDateKey]
        let candidates = (0...2).flatMap { offset -> [URL] in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: latest) else { return [] }
            let directory = root.appendingPathComponent(path.string(from: day), isDirectory: true)
            return (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys),
                                                                  options: [.skipsHiddenFiles])) ?? []
        }
        return candidates.compactMap { file -> (URL, Date)? in
            guard file.pathExtension == "jsonl", file.lastPathComponent.hasPrefix("rollout-"),
                  let values = try? file.resourceValues(forKeys: keys), values.isRegularFile == true,
                  values.isSymbolicLink != true, let modified = values.contentModificationDate else { return nil }
            return (file, modified)
        }.sorted { $0.1 > $1.1 }.prefix(maxFiles).map(\.0)
    }

    private static func tail(_ file: URL) -> Data? {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }
        do {
            let size = try handle.seekToEnd()
            let start = size > UInt64(maxBytesPerFile) ? size - UInt64(maxBytesPerFile) : 0
            try handle.seek(toOffset: start)
            let bytes = try handle.read(upToCount: maxBytesPerFile) ?? Data()
            if start == 0 { return bytes }
            guard let newline = bytes.firstIndex(of: 10) else { return nil }
            return Data(bytes.suffix(from: bytes.index(after: newline)))
        } catch {
            return nil
        }
    }
}
