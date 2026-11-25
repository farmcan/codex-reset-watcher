import CoreFoundation
import Darwin
import Foundation

enum CodexQuota {
    static let sourceID = "resetcat-local-codex"
    static let interval: TimeInterval = 300

    private static var searchPaths: [String] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":")
            .map(String.init).filter { $0.hasPrefix("/") }
            + ["/opt/homebrew/bin", "/usr/local/bin", home + "/.local/bin", home + "/.npm-global/bin",
               "/usr/bin", "/bin"]
    }

    static func executable() -> URL? {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let bundles = ["/Applications", home + "/Applications"].flatMap { directory in
            ["Codex.app", "ChatGPT.app"].flatMap { app in
                let base = directory + "/" + app + "/Contents/Resources/"
                return [base + "codex", base + "codex-cli/CodexCLI.app/Contents/MacOS/codex"]
            }
        }
        return (searchPaths.map { $0 + "/codex" } + bundles)
            .first(where: FileManager.default.isExecutableFile(atPath:))
            .map { URL(fileURLWithPath: $0) }
    }

    static func read(executable: URL) throws -> Data {
        let rpc = try QuotaRPC(executable: executable, searchPaths: searchPaths)
        defer { rpc.close() }
        _ = try rpc.call(id: 1, method: "initialize", params: [
            "clientInfo": ["name": "resetcat_quota_bar", "version": "0.1.2"]
        ])
        try rpc.send(["method": "initialized"])
        let identity = try rpc.call(id: 2, method: "account/read", params: ["refreshToken": false])
        guard let type = (identity["account"] as? [String: Any])?["type"] as? String else {
            throw QuotaError(message: "本机 Codex 尚未登录，请登录后重试。")
        }
        guard type != "apiKey", type != "bedrock" else {
            throw QuotaError(message: "当前 Codex 登录方式不提供订阅额度。请使用 ChatGPT 登录后重试。")
        }
        let result = try rpc.call(id: 3, method: "account/rateLimits/read")
        return try snapshot(result, observed: Date())
    }

    private static func numeric(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }

    static func snapshot(_ result: [String: Any], observed: Date) throws -> Data {
        let buckets = result["rateLimitsByLimitId"] as? [String: [String: Any]] ?? [:]
        let legacy = result["rateLimits"] as? [String: Any]
        let limits = !buckets.isEmpty ? buckets : legacy.map { [($0["limitId"] as? String ?? "codex"): $0] } ?? [:]
        let iso = ISO8601DateFormatter()
        let timestamp = iso.string(from: observed)
        var pools: [[String: Any]] = []
        for key in limits.keys.sorted() {
            guard key.range(of: "^[A-Za-z0-9._:-]{1,72}$", options: .regularExpression) != nil,
                  let limit = limits[key] else { continue }
            for slot in ["primary", "secondary"] {
                guard let window = limit[slot] as? [String: Any],
                      let used = numeric(window["usedPercent"]), used.isFinite, used >= 0, used <= 100 else { continue }
                let duration = numeric(window["windowDurationMins"]).flatMap { Int(exactly: $0) }
                let reset = date(window["resetsAt"])
                let label: String
                switch duration {
                case 10080: label = "周额度"
                case 300: label = "5 小时额度"
                case let value? where value > 0: label = "\(value) 分钟额度"
                default: label = slot == "primary" ? "主额度" : "副额度"
                }
                var pool: [String: Any] = [
                    "sourceId": sourceID, "sourceLabel": "本机 Codex",
                    "poolId": key + "-" + slot, "poolLabel": key == "codex" ? label : key + " · " + label,
                    "cycleId": reset.map { iso.string(from: $0) } ?? "unknown",
                    "unit": "percent", "total": 100, "resetsAt": reset.map { iso.string(from: $0) } as Any? ?? NSNull(),
                    "observations": [["observedAt": timestamp, "remaining": 100 - used]]
                ]
                if let reset, let duration, duration > 0, reset > observed {
                    let start = reset.addingTimeInterval(-Double(duration) * 60)
                    if start <= observed && start.timeIntervalSince1970 > 0 {
                        pool["cycleStart"] = iso.string(from: start)
                        pool["cycleStartBasis"] = "window-length"
                    }
                }
                pools.append(pool)
            }
        }
        let credits = result["rateLimitResetCredits"] as? [String: Any]
        let cardPools = resetCardPools(credits, observed: observed, iso: iso)
        guard !pools.isEmpty || cardPools.contains(where: { pool in
            (pool["observations"] as? [[String: Any]])?.first?["remaining"] is Int
        }) else {
            throw QuotaError(message: "Codex 未返回可用的额度窗口或重置卡读数，请稍后重试。")
        }
        pools.append(contentsOf: cardPools)
        return try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "timezone": TimeZone.current.identifier, "pools": pools
        ])
    }

    private static func date(_ value: Any?) -> Date? {
        numeric(value).flatMap {
            $0.isFinite && $0 > 0 && $0 < 253402300800 ? Date(timeIntervalSince1970: $0) : nil
        }
    }

    private static func resetCardPools(_ credits: [String: Any]?, observed: Date,
                                       iso: ISO8601DateFormatter) -> [[String: Any]] {
        let total = numeric(credits?["availableCount"]).flatMap {
            $0 >= 0 && $0 <= Double(Int32.max) && $0.rounded() == $0 ? Int($0) : nil
        }
        let timestamp = iso.string(from: observed)
        func pool(expiry: Date?, count: Int?) -> [String: Any] {
            let end = expiry.map { iso.string(from: $0) }
            let remaining: Any = count.map { $0 as Any } ?? NSNull()
            return [
                "sourceId": sourceID, "sourceLabel": "本机 Codex",
                "poolId": end.map { "reset-card-" + $0 } ?? "reset-cards-undated",
                "poolLabel": end == nil ? "可用重置卡" : "重置卡",
                "cycleId": "available", "unit": "count", "kind": "reset-credit",
                "expiresAt": end.map { $0 as Any } ?? NSNull(),
                "observations": [["observedAt": timestamp, "remaining": remaining]]
            ]
        }

        if total == 0 { return [pool(expiry: nil, count: 0)] }
        let details = credits?["credits"] as? [[String: Any]] ?? []
        var seen: Set<String> = []
        var byExpiry: [Date: Int] = [:]
        var undated = 0
        for card in details where card["status"] as? String == "available" {
            if let id = card["id"] as? String, !seen.insert(id).inserted { continue }
            if let expiry = date(card["expiresAt"]) {
                if expiry > observed { byExpiry[expiry, default: 0] += 1 }
            } else {
                undated += 1
            }
        }
        let dated = byExpiry.values.reduce(0, +)
        if let total, dated + undated > total {
            return [pool(expiry: nil, count: total)]
        }
        var pools = byExpiry.keys.sorted().map { pool(expiry: $0, count: byExpiry[$0]) }
        if let total, total > dated {
            pools.append(pool(expiry: nil, count: total - dated))
        } else if total == nil && undated > 0 {
            pools.append(pool(expiry: nil, count: undated))
        }
        return pools.isEmpty ? [pool(expiry: nil, count: nil)] : pools
    }
}

private final class QuotaRPC {
    private let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private let deadline = DispatchTime.now().uptimeNanoseconds + 25_000_000_000
    private var pending = Data()

    init(executable: URL, searchPaths: [String]) throws {
        process.executableURL = executable
        process.arguments = ["app-server"]
        process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = searchPaths.joined(separator: ":")
        process.environment = environment
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        _ = fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1)
        do {
            try process.run()
        } catch {
            throw QuotaError(message: "找到了 Codex，但无法启动 CLI。请检查安装后重试。")
        }
    }

    func close() {
        try? input.fileHandleForWriting.close()
        if process.isRunning { process.terminate() }
        try? output.fileHandleForReading.close()
    }

    func send(_ message: [String: Any]) throws {
        var data = try JSONSerialization.data(withJSONObject: message)
        data.append(10)
        do {
            try input.fileHandleForWriting.write(contentsOf: data)
        } catch {
            throw QuotaError(message: "Codex CLI 已退出，请检查安装后重试。")
        }
    }

    func call(id: Int, method: String, params: [String: Any]? = nil) throws -> [String: Any] {
        var request: [String: Any] = ["id": id, "method": method]
        if let params { request["params"] = params }
        try send(request)
        let stdout = output.fileHandleForReading
        var poller = pollfd(fd: stdout.fileDescriptor, events: Int16(POLLIN), revents: 0)
        var buffer = [UInt8](repeating: 0, count: 16_384)
        while DispatchTime.now().uptimeNanoseconds < deadline {
            if let newline = pending.firstIndex(of: 10) {
                let line = Data(pending[..<newline])
                pending.removeSubrange(...newline)
                guard let message = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any],
                      message["id"] as? Int == id else { continue }
                if let result = message["result"] as? [String: Any] { return result }
                if method == "account/rateLimits/read" {
                    throw QuotaError(message: "Codex 额度请求未成功，请检查网络或登录状态后重试。")
                }
                throw QuotaError(message: "当前 Codex CLI 无法读取账户状态，请更新 CLI 后重试。")
            }
            let remaining = deadline - min(deadline, DispatchTime.now().uptimeNanoseconds)
            let polled = poll(&poller, 1, Int32(remaining / 1_000_000))
            if polled < 0 && errno == EINTR { continue }
            if polled == 0 { break }
            guard polled > 0 else { break }
            let count = Darwin.read(stdout.fileDescriptor, &buffer, buffer.count)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else {
                throw QuotaError(message: "Codex CLI 提前退出，请检查安装或登录后重试。")
            }
            pending.append(contentsOf: buffer.prefix(count))
            guard pending.count <= 1_048_576 else {
                throw QuotaError(message: "Codex CLI 返回了无法解析的响应。")
            }
        }
        throw QuotaError(message: "读取 Codex 额度超时，请检查网络后重试。")
    }
}
