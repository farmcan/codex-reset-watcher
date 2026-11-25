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
        precondition(model.panel.sources.first?.pools.map(\.latest.remaining) == [40, 0])
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
