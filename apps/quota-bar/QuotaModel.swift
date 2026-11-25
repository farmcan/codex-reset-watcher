import Foundation
import JavaScriptCore
import SwiftUI

struct QuotaPoint: Decodable {
    let ms: Double
    let remaining: Double?
}
struct QuotaDeadline: Decodable {
    let ms: Double
    let day: Bool
    let type: String

    var label: String {
        switch type {
        case "reset": return "重置"
        case "expiry": return "到期"
        default: return "计划期限"
        }
    }
}
struct QuotaEstimate: Decodable {
    let state: String
    let zeroAt: Double?
    let end: Double?
    let remaining: Double?
    let latest: QuotaPoint?
    let deadline: QuotaDeadline?
}
struct QuotaPool: Decodable, Identifiable {
    let id: String
    let label: String
    let unit: String
    let zone: String
    let total: Double?
    let latest: QuotaPoint
    let estimate: QuotaEstimate
    let deadlines: [QuotaDeadline]
    let groups: [[QuotaPoint]]

    var fraction: Double? {
        guard let total, total > 0, let remaining = latest.remaining else { return nil }
        return min(1, remaining / total)
    }

    func time(_ ms: Double, dayOnly: Bool = false, timeOnly: Bool = false, seconds: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: zone)
        if dayOnly { formatter.dateFormat = "MM/dd" }
        else if timeOnly { formatter.dateFormat = "HH:mm" }
        else { formatter.dateFormat = seconds ? "MM/dd HH:mm:ss" : "MM/dd HH:mm" }
        return formatter.string(from: Date(timeIntervalSince1970: ms / 1_000))
    }
}
struct QuotaSource: Decodable, Identifiable {
    let id: String
    let label: String
    let pools: [QuotaPool]
}
struct QuotaPanelData: Decodable {
    let asOf: Double
    let sources: [QuotaSource]
}

struct QuotaError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

struct QuotaCheck {
    var attempted: Date? = nil
    var next: Date? = nil
    var result = ""
    var failed = false
}

final class QuotaModel: ObservableObject {
    static let watchInterval: TimeInterval = 2
    @Published private(set) var panel = QuotaPanelData(asOf: 0, sources: [])
    @Published private(set) var demo = false
    @Published private(set) var hasRecords = false
    @Published private(set) var error: String?
    @Published private(set) var watchedFile: URL?
    @Published private(set) var status = "等待导入"
    @Published private(set) var codexEnabled = false
    @Published private(set) var codexCheck = QuotaCheck()
    @Published private(set) var fileCheck = QuotaCheck()
    var onChange: (() -> Void)?
    private var codexBusy = false
    private var codexGeneration = UUID()
    private var watchSources: [String] = []

    private let context = JSContext()!
    private let storage: URL
    private let defaults: UserDefaults
    private var records = "[]"
    private var lastFileBytes: Data?
    private var lastImportedFile: URL?
    private var lastPanelMinute: Int?
    private var jsError: String?
    private let maxFileSize = 4 * 1024 * 1024

    init(resource: URL, storage: URL, defaults: UserDefaults = .standard) throws {
        self.storage = storage
        self.defaults = defaults
        codexEnabled = defaults.bool(forKey: "codexQuotaEnabled")
        watchSources = defaults.stringArray(forKey: "watchedSnapshotSources") ?? []
        context.exceptionHandler = { [weak self] _, exception in
            self?.jsError = exception?.toString()
        }
        let source = try String(contentsOf: resource, encoding: .utf8)
        context.evaluateScript(source)
        if let jsError { throw QuotaError(message: jsError) }
        if FileManager.default.fileExists(atPath: storage.path) {
            records = try String(contentsOf: storage, encoding: .utf8)
            hasRecords = records != "[]"
        }
        if let path = defaults.string(forKey: "watchedSnapshot") {
            watchedFile = URL(fileURLWithPath: path)
        }
        if let path = defaults.string(forKey: "lastImportedSnapshot") {
            lastImportedFile = URL(fileURLWithPath: path)
        }
        try updatePanel()
    }

    var staleSources: [String] {
        guard !demo else { return [] }
        return (codexCheck.failed ? [CodexQuota.sourceID] : []) + (fileCheck.failed ? watchSources : [])
    }

    func lastObservation(codex: Bool) -> Date? {
        guard !demo else { return nil }
        let ids = codex ? [CodexQuota.sourceID] : watchSources
        return panel.sources.filter { ids.contains($0.id) }.flatMap(\.pools)
            .map(\.latest.ms).max().map { Date(timeIntervalSince1970: $0 / 1000) }
    }

    var chartState: String {
        let stale = (try? JSONEncoder().encode(staleSources)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return "{\"saved\":" + records + ",\"demo\":" + (demo ? "true" : "false") + ",\"stale\":" + stale + "}"
    }

    var example: String { (try? call("example", [])) ?? "{}" }
    var agentGuide: String { (try? call("agentGuide", [])) ?? "" }
    var template: String { (try? call("template", [])) ?? "{}" }

    func showDemo(_ show: Bool) {
        demo = show
        update()
    }

    func importFile(_ url: URL, watch: Bool) {
        do {
            let bytes = try boundedRead(url)
            try importBytes(bytes)
            if watch {
                watchedFile = url
                defaults.set(url.path, forKey: "watchedSnapshot")
                rememberWatchedSources(bytes)
                lastFileBytes = bytes
                let date = Date()
                fileCheck = QuotaCheck(attempted: date, next: date.addingTimeInterval(Self.watchInterval), result: "已接通")
                update()
            } else {
                lastImportedFile = url
                defaults.set(url.path, forKey: "lastImportedSnapshot")
            }
        } catch {
            self.error = failureMessage(error)
        }
    }

    func connectCodex() {
        guard !codexEnabled else { refreshCodex(force: true); return }
        codexEnabled = true
        demo = false
        update()
        defaults.set(true, forKey: "codexQuotaEnabled")
        refreshCodex(force: true)
    }

    func disconnectCodex() {
        codexEnabled = false
        codexBusy = false
        codexGeneration = UUID()
        defaults.removeObject(forKey: "codexQuotaEnabled")
        codexCheck = QuotaCheck(result: "已停止", failed: true)
        update()
    }

    private func refreshCodex(force: Bool) {
        let started = Date()
        guard codexEnabled, !codexBusy, force || (codexCheck.next ?? .distantPast) <= started else { return }
        guard let cli = CodexQuota.executable() else {
            finishCodex(.failure(QuotaError(message: "未找到 Codex CLI，请安装并登录后重试。")))
            return
        }
        codexBusy = true
        if codexCheck.attempted == nil {
            codexCheck.result = "正在验证"
        }
        let generation = codexGeneration
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let result = Result { try CodexQuota.read(executable: cli) }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.codexEnabled, self.codexGeneration == generation else { return }
                self.finishCodex(result)
            }
        }
    }

    private func finishCodex(_ result: Result<Data, Error>) {
        codexBusy = false
        let date = Date()
        let next = date.addingTimeInterval(CodexQuota.interval)
        do {
            let bytes = try result.get()
            try importBytes(bytes, leaveDemo: false)
            codexCheck = QuotaCheck(attempted: date, next: next, result: "刷新成功")
        } catch {
            codexCheck = QuotaCheck(attempted: date, next: next, result: Self.problemText(error), failed: true)
        }
        update()
    }

    func refresh(force: Bool = false) {
        let date = Date()
        refreshCodex(force: force)
        if let file = watchedFile, force || (fileCheck.next ?? .distantPast) <= date {
            refreshFile(file, at: date)
        } else if force, watchedFile == nil, let file = lastImportedFile {
            importFile(file, watch: false)
        } else if force {
            error = nil
        }
        let minute = Int(date.timeIntervalSince1970 / 60)
        if force || lastPanelMinute != minute {
            lastPanelMinute = minute
            update()
        }
    }

    private func refreshFile(_ file: URL, at date: Date) {
        let next = date.addingTimeInterval(Self.watchInterval)
        let wasFailed = fileCheck.failed
        do {
            let bytes = try boundedRead(file)
            if bytes != lastFileBytes || wasFailed {
                let previous = records
                try importBytes(bytes, leaveDemo: false)
                rememberWatchedSources(bytes)
                lastFileBytes = bytes
                fileCheck = QuotaCheck(attempted: date, next: next, result: records == previous ? "可读 · 无新观测" : "已更新")
            } else {
                fileCheck = QuotaCheck(attempted: date, next: next, result: "可读 · 无新观测")
            }
            if wasFailed { update() }
        } catch {
            fileCheck = QuotaCheck(attempted: date, next: next, result: Self.problemText(error), failed: true)
            if !wasFailed { update() }
        }
    }

    private func rememberWatchedSources(_ bytes: Data) {
        guard let text = String(data: bytes, encoding: .utf8), let raw = try? call("sources", [text]),
              let ids = try? JSONDecoder().decode([String].self, from: Data(raw.utf8)) else { return }
        watchSources = ids
        defaults.set(ids, forKey: "watchedSnapshotSources")
    }

    func stopWatching() {
        watchedFile = nil
        lastFileBytes = nil
        watchSources = []
        defaults.removeObject(forKey: "watchedSnapshot")
        defaults.removeObject(forKey: "watchedSnapshotSources")
        fileCheck = QuotaCheck()
        error = nil
        update()
    }

    func clear() {
        do {
            if FileManager.default.fileExists(atPath: storage.path) {
                try FileManager.default.removeItem(at: storage)
            }
            records = "[]"
            hasRecords = false
            demo = false
            lastImportedFile = nil
            defaults.removeObject(forKey: "lastImportedSnapshot")
            stopWatching()
            if codexEnabled { disconnectCodex() }
        } catch {
            self.error = "无法清除本机记录。"
        }
    }

    private static func problemText(_ error: Error) -> String {
        let firstLine = error.localizedDescription.components(separatedBy: .newlines)[0]
        return firstLine.replacingOccurrences(of: "Error: ", with: "")
    }

    private func failureMessage(_ error: Error) -> String {
        "更新失败 · " + Self.problemText(error)
    }

    private func boundedRead(_ url: URL) throws -> Data {
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, let size = values.fileSize, size <= maxFileSize else {
            throw QuotaError(message: "请选择 4 MB 以内的 JSON 文件。")
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let bytes = try handle.read(upToCount: maxFileSize + 1) ?? Data()
        guard bytes.count <= maxFileSize else { throw QuotaError(message: "快照文件超过 4 MB。") }
        return bytes
    }

    private func importBytes(_ bytes: Data, leaveDemo: Bool = true) throws {
        guard let text = String(data: bytes, encoding: .utf8) else {
            throw QuotaError(message: "文件应使用 UTF-8 编码。")
        }
        let merged = try call("merge", [text, records, now])
        if merged != records {
            try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(merged.utf8).write(to: storage, options: .atomic)
            records = merged
        }
        hasRecords = records != "[]"
        if leaveDemo { demo = false }
        error = nil
        update()
    }

    private var now: Double { Date().timeIntervalSince1970 * 1_000 }

    private func call(_ method: String, _ arguments: [Any]) throws -> String {
        jsError = nil
        let result = context.objectForKeyedSubscript("quotaModel")?.invokeMethod(method, withArguments: arguments)
        if let jsError { throw QuotaError(message: jsError) }
        guard let result, result.isString else { throw QuotaError(message: "额度计算返回了无效结果。") }
        return result.toString()
    }

    private func updatePanel() throws {
        let data = try call("panel", [records, demo, now])
        panel = try JSONDecoder().decode(QuotaPanelData.self, from: Data(data.utf8))
        if demo {
            status = "演示数据"
        } else if let latest = panel.sources.flatMap(\.pools).max(by: { $0.latest.ms < $1.latest.ms }) {
            status = "观测 " + latest.time(latest.latest.ms, seconds: true)
        } else {
            status = "等待导入"
        }
    }

    private func update() {
        do {
            try updatePanel()
            onChange?()
        } catch {
            self.error = "无法显示额度快照。"
        }
    }
}
