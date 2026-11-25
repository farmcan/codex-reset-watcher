import Foundation

@main
struct CheckCodex {
    static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count == 2 || arguments.count == 3 else {
            throw QuotaError(message: "Usage: check-codex quota-model.js [--live]")
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let suite = "dev.resetcat.quota-bar.test." + UUID().uuidString
        guard let defaults = UserDefaults(suiteName: suite) else { fatalError("Could not allocate isolated defaults") }
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = try QuotaModel(resource: URL(fileURLWithPath: arguments[1]),
                                  storage: root.appendingPathComponent("snapshots.json"), defaults: defaults)
        let fixture = try CodexQuota.snapshot([
            "accountId": "test-private-id",
            "rateLimits": [
                "primary": ["usedPercent": 60, "windowDurationMins": 300],
                "secondary": ["usedPercent": 100, "windowDurationMins": 10080]
            ]
        ], observed: Date())
        let snapshot = String(decoding: fixture, as: UTF8.self)
        precondition(!snapshot.contains("test-private-id"))
        precondition(!snapshot.contains("usedPercent"))
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("quota-snapshot.json")
        try fixture.write(to: file, options: .atomic)
        model.importFile(file, watch: true)
        precondition(model.panel.sources.first?.pools.filter { !$0.isResetCredit }.map(\.latest.remaining) == [40, 0])
        try Data("{broken".utf8).write(to: file, options: .atomic)
        Thread.sleep(forTimeInterval: QuotaModel.watchInterval)
        model.refresh()
        precondition(model.fileCheck.failed)
        precondition(model.staleSources == [CodexQuota.sourceID])
        precondition(model.panel.sources.first?.pools.first?.latest.remaining == 40)
        let updated = try CodexQuota.snapshot([
            "rateLimits": ["primary": ["usedPercent": 72, "windowDurationMins": 300]]
        ], observed: Date())
        try updated.write(to: file, options: .atomic)
        Thread.sleep(forTimeInterval: QuotaModel.watchInterval)
        model.refresh()
        precondition(!model.fileCheck.failed)
        precondition(model.staleSources.isEmpty)
        precondition(model.panel.sources.first?.pools.first?.latest.remaining == 28)
        precondition(model.chartState.contains("\"remaining\":28"))
        print("PASS: bad file kept last good value; next atomic update reached both views")
        let sampleDate = Date(timeIntervalSince1970: 1_800_000_000)
        let now = sampleDate.timeIntervalSince1970
        func readFixture(_ credits: [String: Any]?) throws -> [[String: Any]] {
            var raw: [String: Any] = [
                "rateLimits": ["primary": [
                    "usedPercent": 50, "windowDurationMins": 300, "resetsAt": now + 3600
                ]]
            ]
            if let credits { raw["rateLimitResetCredits"] = credits }
            let json = try CodexQuota.snapshot(raw, observed: sampleDate)
            return (try JSONSerialization.jsonObject(with: json) as? [String: Any])?["pools"] as? [[String: Any]] ?? []
        }

        let batches = try readFixture([
            "availableCount": 2, "credits": [
                ["id": "sample-a", "status": "available", "expiresAt": now + 3600 * 24],
                ["id": "sample-b", "status": "available", "expiresAt": now + 3600 * 48],
                ["id": "sample-used", "status": "used", "expiresAt": now + 3600 * 72]
            ]
        ])
        precondition(batches.count == 3)
        precondition(batches[0]["cycleStartBasis"] as? String == "window-length")
        let iso = ISO8601DateFormatter()
        precondition(iso.date(from: batches[0]["cycleStart"] as? String ?? "")?.timeIntervalSince1970 == now - 4 * 3600)
        precondition(batches[1]["expiresAt"] as? String != batches[2]["expiresAt"] as? String)
        precondition(!String(describing: batches).contains("sample-"))
        func remaining(_ pools: [[String: Any]]) -> Any? {
            (pools.last?["observations"] as? [[String: Any]])?.first?["remaining"]
        }
        let unavailable = try readFixture(nil)
        let summary = try readFixture(["availableCount": 3, "credits": NSNull()])
        let zero = try readFixture(["availableCount": 0, "credits": []])
        precondition(remaining(unavailable) is NSNull)
        precondition(remaining(summary) as? Int == 3 && summary.last?["expiresAt"] is NSNull)
        precondition(remaining(zero) as? Int == 0)
        print("PASS: inferred start, separate card expiries, used card excluded, count-only, unknown and explicit zero")

        if arguments.dropFirst(2).first == "--live-once" {
            guard let executable = CodexQuota.executable() else { throw QuotaError(message: "Codex CLI not found") }
            let bytes = try CodexQuota.read(executable: executable)
            let data = (try JSONSerialization.jsonObject(with: bytes) as? [String: Any])?["pools"] as? [[String: Any]] ?? []
            precondition(data.contains { $0["kind"] as? String == "reset-credit" })
            print("PASS: real read-only Codex response converted, no account values logged")
            return
        }
        guard arguments.dropFirst(2).first == "--live" else { return }

        model.clear()
        model.connectCodex()
        let start = Date()
        var first: Double?
        while Date().timeIntervalSince(start) < CodexQuota.interval + 60 {
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(1))
            model.refresh()
            guard model.codexCheck.result == "刷新成功",
                  let source = model.panel.sources.first(where: { $0.id == CodexQuota.sourceID }),
                  let observation = source.pools.first?.latest.ms else { continue }
            if let first, observation > first {
                precondition(observation - first >= 295_000)
                model.disconnectCodex()
                print("PASS: two real read-only observations through the five-minute automatic refresh")
                return
            }
            if first == nil {
                first = observation
                print("PASS: one real read-only observation; waiting for automatic refresh")
                fflush(stdout)
            }
        }
        throw QuotaError(message: "Automatic Codex refresh did not complete: " + model.codexCheck.result)
    }
}
