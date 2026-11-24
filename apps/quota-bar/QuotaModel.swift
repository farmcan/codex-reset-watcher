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

    func time(_ ms: Double, dayOnly: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = TimeZone(identifier: zone)
        formatter.dateFormat = dayOnly ? "MM/dd" : "MM/dd HH:mm"
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

final class QuotaModel: ObservableObject {
    @Published private(set) var panel = QuotaPanelData(asOf: 0, sources: [])
    @Published private(set) var demo = false
    @Published private(set) var hasRecords = false
    @Published private(set) var error: String?
    @Published private(set) var watchedFile: URL?
    @Published private(set) var status = "等待导入"
    var onChange: (() -> Void)?

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

    var chartState: String {
        "{\"saved\":" + records + ",\"demo\":" + (demo ? "true" : "false") + "}"
    }

    var example: String { (try? call("example", [])) ?? "{}" }

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
                lastFileBytes = bytes
            } else {
                lastImportedFile = url
                defaults.set(url.path, forKey: "lastImportedSnapshot")
            }
        } catch {
            self.error = failureMessage(error)
        }
    }

    func refresh(force: Bool = false) {
        if let file = watchedFile ?? (force ? lastImportedFile : nil) {
            do {
                let bytes = try boundedRead(file)
                if force || bytes != lastFileBytes {
                    lastFileBytes = bytes
                    try importBytes(bytes)
                }
            } catch {
                let message = failureMessage(error)
                if self.error != message { self.error = message }
            }
        } else if force {
            error = nil
        }
        let minute = Int(Date().timeIntervalSince1970 / 60)
        if force || lastPanelMinute != minute {
            lastPanelMinute = minute
            update()
        }
    }

    func stopWatching() {
        watchedFile = nil
        lastFileBytes = nil
        defaults.removeObject(forKey: "watchedSnapshot")
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
        } catch {
            self.error = "无法清除本机记录。"
        }
    }

    private func failureMessage(_ error: Error) -> String {
        let firstLine = error.localizedDescription.components(separatedBy: .newlines)[0]
        return "更新失败 · " + firstLine.replacingOccurrences(of: "Error: ", with: "")
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

    private func importBytes(_ bytes: Data) throws {
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
        demo = false
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
            status = latest.time(latest.latest.ms)
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
