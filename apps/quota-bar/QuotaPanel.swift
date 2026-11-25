import AppKit
import SwiftUI

extension Color {
    static let quotaInk = Color(nsColor: .labelColor)
    static let quotaQuiet = Color(nsColor: .secondaryLabelColor)
    static let quotaPink = Color(light: 0xA92164, dark: 0xFF91BF)
    static let quotaSurface = Color(light: 0xFCF5F9, dark: 0x251B27)
    static let quotaTrack = Color(light: 0xECDDE6, dark: 0x50384A)
    static let quotaBadge = Color(light: 0xF8E5F0, dark: 0x473043)
    static let quotaAmber = Color(light: 0x9A500B, dark: 0xFFC180)

    private init(light: UInt32, dark: UInt32) {
        self.init(nsColor: NSColor(name: nil) { appearance in
            let appearanceName = appearance.bestMatch(from: [.aqua, .darkAqua])
            let hex = appearanceName == .darkAqua ? dark : light
            return NSColor(
                srgbRed: CGFloat((hex >> 16) & 255) / 255,
                green: CGFloat((hex >> 8) & 255) / 255,
                blue: CGFloat(hex & 255) / 255, alpha: 1
            )
        })
    }
}

struct CatOutline: Shape {
    func path(in rect: CGRect) -> Path {
        let px: (CGFloat, CGFloat) -> CGPoint = { x, y in
            CGPoint(x: rect.minX + rect.width * x / 18, y: rect.minY + rect.height * y / 18)
        }
        var path = Path()
        path.move(to: px(2.2, 2.4))
        path.addLine(to: px(5.9, 5.0))
        path.addQuadCurve(to: px(12.1, 5.0), control: px(9, 3.5))
        path.addLine(to: px(15.8, 2.4))
        path.addLine(to: px(15.3, 10.4))
        path.addQuadCurve(to: px(9, 16.4), control: px(15, 16.4))
        path.addQuadCurve(to: px(2.7, 10.4), control: px(3, 16.4))
        path.closeSubpath()
        path.move(to: px(6.05, 9.6))
        path.addLine(to: px(6.1, 9.6))
        path.move(to: px(11.85, 9.6))
        path.addLine(to: px(11.9, 9.6))
        path.move(to: px(8.2, 11.8))
        path.addQuadCurve(to: px(9.8, 11.8), control: px(9, 13.4))
        return path
    }

    static func image(size: CGFloat, color: NSColor = .black) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { area in
            let path = NSBezierPath(cgPath: CatOutline().path(in: area).cgPath)
            path.lineWidth = size / 12
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            color.setStroke()
            path.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }
}

struct QuotaActions {
    let refresh: () -> Void
    let chooseFile: (Bool) -> Void
    let stopWatching: () -> Void
    let connectCodex: () -> Void
    let disconnectCodex: () -> Void
    let copy: (Bool) -> Void
    let demo: () -> Void
    let clear: () -> Void
    let charts: () -> Void
    let quit: () -> Void
    let dismiss: () -> Void
}

struct QuotaPanel: View {
    @ObservedObject var model: QuotaModel
    let actions: QuotaActions
    @State private var copyNotice = ""
    @State private var selection: [String: String] = [:]

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.quotaTrack)
            if let error = model.error {
                Text(error).font(.system(size: 10)).foregroundStyle(Color.quotaAmber)
                    .lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 13).padding(.vertical, 4)
            }
            connectionStatus
            if model.panel.sources.isEmpty {
                VStack(alignment: .leading, spacing: 7) {
                    Button(model.codexEnabled ? "重试 Codex" : "连接 Codex", action: actions.connectCodex)
                        .buttonStyle(.borderedProminent).tint(Color.quotaPink)
                        .accessibilityIdentifier("connect-codex")
                    Text("连接已登录的本机 Codex · 每 5 分钟读取额度")
                        .font(.system(size: 10)).foregroundStyle(Color.quotaQuiet)
                    Divider().overlay(Color.quotaTrack)
                    Text("连接 Agent 快照")
                        .font(.system(size: 12, weight: .semibold))
                    HStack(spacing: 6) {
                        Button("监测本机快照") { actions.chooseFile(true) }
                            .accessibilityIdentifier("watch-snapshot")
                        Button("复制接入指令") { copy(template: false) }
                            .accessibilityIdentifier("copy-agent-guide")
                        Button("v1 模板") { copy(template: true) }
                            .accessibilityIdentifier("copy-v1-template")
                    }
                    Text(copyNotice.isEmpty ? "选定一个文件，Agent 更新后面板会自动刷新。" : copyNotice)
                        .font(.system(size: 10)).foregroundStyle(Color.quotaQuiet)
                        .accessibilityIdentifier("agent-copy-status")
                    HStack {
                        Button("一次性导入 JSON") { actions.chooseFile(false) }
                            .accessibilityIdentifier("import-json")
                        Button("加载演示", action: actions.demo)
                            .accessibilityIdentifier("load-demo")
                    }
                    .buttonStyle(.link)
                }
                .controlSize(.small)
                .padding(13)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            } else {
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        ForEach(model.panel.sources) { source in
                            if let pool = source.pools.first(where: { $0.id == selection[source.id] }) ?? source.pools.first {
                                quotaRow(source, pool)
                                Divider().overlay(Color.quotaTrack)
                            }
                        }
                    }
                    .padding(.horizontal, 13)
                }
                .accessibilityIdentifier("quota-sources")
            }
            Divider().overlay(Color.quotaTrack)
            HStack {
                Text(model.watchedFile == nil ? "本机快照 · 估算供参考" : "监测本机文件 · 估算供参考")
                    .font(.system(size: 10)).foregroundStyle(Color.quotaQuiet)
                Spacer()
                Button("完整图表", action: actions.charts)
                    .buttonStyle(.plain).foregroundStyle(Color.quotaPink)
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityIdentifier("full-charts")
            }
            .padding(.horizontal, 13)
            .frame(height: 33)
        }
        .frame(width: 330, height: 350)
        .background(Color.quotaSurface)
        .foregroundStyle(Color.quotaInk)
        .onExitCommand(perform: actions.dismiss)
    }

    private var header: some View {
        HStack(spacing: 8) {
            CatOutline().stroke(Color.quotaPink, style: StrokeStyle(lineWidth: 1.15, lineCap: .round, lineJoin: .round))
                .frame(width: 15, height: 15).accessibilityHidden(true)
            Text("额度").font(.system(size: 13, weight: .bold))
            Spacer()
            Text(model.status).font(.system(size: 10)).foregroundStyle(Color.quotaQuiet)
                .accessibilityIdentifier("quota-status")
            Button(action: actions.refresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 12))
            }
            .buttonStyle(.plain).accessibilityLabel("刷新快照")
            .accessibilityIdentifier("refresh-quota")
            Menu {
                Button(model.codexEnabled ? "立即刷新 Codex" : "连接 Codex…", action: actions.connectCodex)
                if model.codexEnabled { Button("停止连接 Codex", action: actions.disconnectCodex) }
                Divider()
                Button("一次性导入 JSON…") { actions.chooseFile(false) }
                Button("监测本机快照…") { actions.chooseFile(true) }
                Button("复制 Agent 接入指令") { copy(template: false) }
                Button("复制 v1 模板") { copy(template: true) }
                if model.watchedFile != nil { Button("停止监测快照", action: actions.stopWatching) }
                Button(model.demo ? "退出演示" : "加载演示", action: actions.demo)
                if model.hasRecords { Button("清除本机记录…", role: .destructive, action: actions.clear) }
                Divider()
                Button("收起面板", action: actions.dismiss)
                Button("退出额度面板", action: actions.quit)
            } label: {
                Image(systemName: "gearshape").font(.system(size: 12))
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .accessibilityLabel("设置")
        }
        .padding(.horizontal, 13)
        .frame(height: 34)
    }

    private func quotaRow(_ source: QuotaSource, _ pool: QuotaPool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(sourceBadge(source.label))
                .font(.system(size: 11, weight: .semibold)).foregroundStyle(Color.quotaPink)
                .frame(width: 22, height: 22)
                .background(Color.quotaBadge, in: RoundedRectangle(cornerRadius: 5))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(source.label).font(.system(size: 12, weight: .bold))
                        .lineLimit(1).help(source.label)
                    Spacer(minLength: 3)
                    Text(balance(pool)).font(.system(size: 14, weight: .bold))
                        .monospacedDigit().lineLimit(1)
                        .accessibilityIdentifier("balance-" + source.id)
                }
                Text(unitLine(pool)).font(.system(size: 10)).foregroundStyle(Color.quotaQuiet)
                    .lineLimit(1)
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.quotaTrack)
                        if let fraction = pool.fraction {
                            Capsule().fill(Color.quotaPink).frame(width: geometry.size.width * fraction)
                        }
                    }
                }
                .frame(height: 3)
                .accessibilityLabel("剩余比例")
                .accessibilityValue(pool.fraction.map { number($0 * 100) + "%" } ?? "未知")
                let stale = model.staleSources.contains(source.id)
                Sparkline(pool: pool, includePrediction: !stale)
                    .frame(height: 9).accessibilityLabel("迷你燃尽图")
                Text(stale ? "来源暂不可用 · 旧快照" : estimateLine(pool))
                    .font(.system(size: 10)).lineLimit(1)
                    .foregroundStyle(stale || pool.estimate.state == "forecast" ? Color.quotaAmber : Color.quotaQuiet)
                HStack(spacing: 4) {
                    if source.pools.count > 1 {
                        Menu {
                            ForEach(source.pools) { option in
                                Button(option.label + " · " + deadlineLine(option)) { selection[source.id] = option.id }
                            }
                        } label: {
                            Text(pool.label).font(.system(size: 10)).lineLimit(1)
                        }
                        .menuStyle(.borderlessButton)
                        .accessibilityLabel(source.label + "额度池")
                    }
                    Spacer(minLength: 0)
                    Text(deadlineLine(pool)).lineLimit(1)
                }
                .font(.system(size: 9)).foregroundStyle(Color.quotaQuiet)
                .frame(height: 12)
            }
        }
        .padding(.vertical, 4)
    }

    private func sourceBadge(_ label: String) -> String {
        if let last = label.split(separator: " ").last, last.count == 1 {
            return String(last).uppercased()
        }
        return String(label.prefix(1)).uppercased()
    }

    private func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    private func balance(_ pool: QuotaPool) -> String {
        guard let remaining = pool.latest.remaining else { return "—" }
        return number(remaining) + (pool.unit == "percent" ? "%" : " " + pool.unit)
    }

    private func unitLine(_ pool: QuotaPool) -> String {
        if pool.unit == "percent" { return "比例额度 · 百分比" }
        if let total = pool.total { return "总额 " + number(total) + " " + pool.unit }
        return "总量未知 · " + pool.unit
    }

    private func deadlineLine(_ pool: QuotaPool) -> String {
        guard let marker = pool.deadlines.first else { return "期限未知" }
        return pool.time(marker.ms, dayOnly: marker.day) + " " + marker.label
    }

    private func estimateLine(_ pool: QuotaPool) -> String {
        switch pool.estimate.state {
        case "forecast":
            if let left = pool.estimate.remaining, left > 0, let deadline = pool.estimate.deadline {
                let unit = pool.unit == "percent" ? "%" : " " + (pool.unit == "credits" ? "Credits" : pool.unit)
                return deadline.label + "时预计剩 " + number(left) + unit
            }
            if let zero = pool.estimate.zeroAt {
                let minutes = ceil((zero - model.panel.asOf) / 60_000)
                var calendar = Calendar(identifier: .gregorian)
                if let zone = TimeZone(identifier: pool.zone) { calendar.timeZone = zone }
                let sameDay = calendar.isDate(
                    Date(timeIntervalSince1970: zero / 1_000),
                    inSameDayAs: Date(timeIntervalSince1970: model.panel.asOf / 1_000)
                )
                let time = pool.time(zero, timeOnly: sameDay)
                return minutes > 0 ? "预计 " + time + " 耗尽 · 约 " + duration(minutes) : "预计耗尽时间已过 · " + time
            }
            return "历史积累中"
        case "empty": return "已耗尽"
        case "stale": return "旧快照"
        case "update": return "待更新"
        case "flat": return "余额持平"
        default: return "历史积累中"
        }
    }

    private func duration(_ minutes: Double) -> String {
        if minutes < 60 { return number(minutes) + " 分钟" }
        if minutes >= 1440 { return number(minutes / 1440) + " 天" }
        let hours = floor(minutes / 60)
        let tail = minutes.truncatingRemainder(dividingBy: 60)
        return number(hours) + " 小时" + (tail > 0 ? " " + number(tail) + " 分钟" : "")
    }

    private func copy(template: Bool) {
        actions.copy(template)
        copyNotice = template ? "已复制 v1 JSON 模板。" : "已复制接入指令。"
    }

    @ViewBuilder private var connectionStatus: some View {
        if model.codexEnabled || model.watchedFile != nil {
            VStack(alignment: .leading, spacing: 4) {
                if model.codexEnabled {
                    connectionRow("Codex · 每 5 分钟", model.codexCheck,
                                  observed: model.lastObservation(codex: true), retry: actions.connectCodex)
                }
                if model.watchedFile != nil {
                    connectionRow("本机文件 · 每 2 秒", model.fileCheck,
                                  observed: model.lastObservation(codex: false), retry: actions.refresh)
                }
            }.padding(.horizontal, 13).padding(.vertical, 5)
            Divider().overlay(Color.quotaTrack)
        }
    }

    private func connectionRow(_ label: String, _ check: QuotaCheck, observed: Date?, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Text(label).fontWeight(.semibold)
                Spacer(minLength: 2)
                if check.failed {
                    Button("重试", action: retry).buttonStyle(.link)
                }
            }
            Text(check.failed ? "刷新失败 · " + check.result : check.result)
                .foregroundStyle(check.failed ? Color.quotaAmber : Color.quotaQuiet)
                .lineLimit(2)
            Text("观测 " + checkTime(observed) + " · 检查 " + checkTime(check.attempted) + " · 下次 " + checkTime(check.next))
                .foregroundStyle(Color.quotaQuiet)
        }
        .font(.system(size: 9))
    }

    private func checkTime(_ date: Date?) -> String {
        guard let date else { return "—" }
        return date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits))
    }
}

struct Sparkline: View {
    let pool: QuotaPool
    let includePrediction: Bool

    var body: some View {
        Canvas { context, size in
            let points = pool.groups.flatMap { $0 }
            guard let first = points.first, let last = points.last else { return }
            let end = includePrediction ? max(last.ms, pool.estimate.end ?? last.ms) : last.ms
            let duration = max(1, end - first.ms)
            let maximum = max(pool.total ?? 1, points.compactMap(\.remaining).max() ?? 1)
            func position(_ point: QuotaPoint) -> CGPoint {
                let x = CGFloat((point.ms - first.ms) / duration) * max(1, size.width - 2) + 1
                let y = (1 - CGFloat((point.remaining ?? 0) / maximum)) * (size.height - 2) + 1
                return CGPoint(x: x, y: y)
            }
            for group in pool.groups {
                guard let start = group.first else { continue }
                var line = Path()
                line.move(to: position(start))
                if group.count == 1 {
                    let point = position(start)
                    context.fill(Path(ellipseIn: CGRect(x: point.x - 1, y: point.y - 1, width: 2, height: 2)), with: .color(.quotaPink))
                } else {
                    for point in group.dropFirst() { line.addLine(to: position(point)) }
                    context.stroke(line, with: .color(.quotaPink), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                }
            }
            if includePrediction, let latest = pool.estimate.latest, let end = pool.estimate.end, let remaining = pool.estimate.remaining {
                var projected = Path()
                projected.move(to: position(latest))
                projected.addLine(to: position(QuotaPoint(ms: end, remaining: remaining)))
                context.stroke(projected, with: .color(.quotaAmber), style: StrokeStyle(lineWidth: 1.25, dash: [3, 3]))
            }
        }
    }
}
