import AppKit
import SwiftUI
import UniformTypeIdentifiers
import WebKit

final class QuotaBar: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private let model: QuotaModel
    private let chartURL: URL
    private lazy var item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let popover = NSPopover()
    private var floatingPanel: NSPanel?
    private var chartWindow: NSWindow?
    private weak var chartView: WKWebView?
    private var chartReady = false
    private var timer: Timer?

    init(model: QuotaModel, chartURL: URL) {
        self.model = model
        self.chartURL = chartURL
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        item.autosaveName = "ResetCatQuotaStatus"
        item.isVisible = true
        if let button = item.button {
            button.image = CatOutline.image(size: 18)
            button.imagePosition = .imageOnly
            button.toolTip = "ResetCat 额度"
            button.setAccessibilityLabel("ResetCat 额度")
            button.setAccessibilityIdentifier("resetcat-quota-menu")
            button.target = self
            button.action = #selector(toggle)
        }
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 330, height: 350)
        popover.contentViewController = NSHostingController(rootView: panelView())
        model.onChange = { [weak self] in self?.updateCharts() }
        model.refresh(force: true)
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.model.refresh()
        }
        if !UserDefaults.standard.bool(forKey: "didShowWelcomePanel") {
            UserDefaults.standard.set(true, forKey: "didShowWelcomePanel")
            DispatchQueue.main.async { [weak self] in self?.showInitialPanel() }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if floatingPanel?.isVisible == true {
            floatingPanel?.makeKeyAndOrderFront(nil)
        } else if !popover.isShown {
            DispatchQueue.main.async { [weak self] in self?.showInitialPanel() }
        }
        return false
    }

    private func showInitialPanel() {
        if !popover.isShown && floatingPanel?.isVisible != true {
            toggle()
        }
    }

    @objc private func toggle() {
        if popover.isShown {
            popover.performClose(nil)
            return
        }
        floatingPanel?.orderOut(nil)
        model.refresh()
        guard let button = item.button, let window = button.window, window.isVisible else {
            showFloatingPanel()
            return
        }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func panelView() -> QuotaPanel {
        QuotaPanel(model: model, actions: QuotaActions(
            refresh: { [weak self] in self?.model.refresh(force: true) },
            chooseFile: { [weak self] watch in self?.chooseFile(watch: watch) },
            stopWatching: { [weak self] in self?.model.stopWatching() },
            connectCodex: { [weak self] in self?.confirmCodex() },
            disconnectCodex: { [weak self] in self?.model.disconnectCodex() },
            copy: { [weak self] template in self?.copyAgentText(template: template) },
            demo: { [weak self] in self.map { $0.model.showDemo(!$0.model.demo) } },
            clear: { [weak self] in self?.confirmClear() },
            charts: { [weak self] in self?.showCharts() },
            quit: { NSApp.terminate(nil) },
            dismiss: { [weak self] in
                self?.popover.performClose(nil)
                self?.floatingPanel?.orderOut(nil)
            }
        ))
    }

    private func showFloatingPanel() {
        model.refresh()
        if floatingPanel == nil {
            let panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 330, height: 350),
                styleMask: [.titled, .closable, .utilityWindow], backing: .buffered, defer: false
            )
            panel.title = "ResetCat 额度"
            panel.isReleasedWhenClosed = false
            panel.contentViewController = NSHostingController(rootView: panelView())
            panel.center()
            floatingPanel = panel
        }
        NSApp.activate(ignoringOtherApps: true)
        floatingPanel?.makeKeyAndOrderFront(nil)
    }

    private func confirmCodex() {
        if model.codexEnabled {
            model.connectCodex()
            return
        }
        popover.performClose(nil)
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "连接本机 Codex？"
        alert.informativeText = "使用你已登录的本机 Codex 只读查询额度。应用运行时每 5 分钟检查一次，观测保存在本机。可以随时从设置停止。"
        alert.addButton(withTitle: "同意并连接")
        alert.addButton(withTitle: "取消")
        if alert.runModal() == .alertFirstButtonReturn { model.connectCodex() }
        showAfterDialog()
    }

    private func copyAgentText(template: Bool) {
        let text = template ? model.template : model.agentGuide
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func chooseFile(watch: Bool) {
        popover.performClose(nil)
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        panel.title = watch ? "选定本机额度快照" : "导入额度快照"
        panel.prompt = watch ? "开始监测" : "导入"
        if panel.runModal() == .OK, let url = panel.url { model.importFile(url, watch: watch) }
        showAfterDialog()
    }

    private func showAfterDialog() {
        guard chartWindow?.isVisible != true, floatingPanel?.isVisible != true else { return }
        DispatchQueue.main.async { [weak self] in self?.showFloatingPanel() }
    }

    private func confirmClear() {
        popover.performClose(nil)
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "清除本机额度记录？"
        alert.informativeText = "会删除本机历史，并停止 Codex 刷新和文件监测。"
        alert.addButton(withTitle: "保留")
        alert.addButton(withTitle: "清除")
        if alert.runModal() == .alertSecondButtonReturn { model.clear() }
        showAfterDialog()
    }

    private func saveExample() {
        let dialog = NSSavePanel()
        dialog.allowedContentTypes = [.json]
        dialog.nameFieldStringValue = "quota-snapshot.json"
        if dialog.runModal() == .OK, let url = dialog.url {
            do {
                try Data(model.example.utf8).write(to: url, options: .atomic)
            } catch {
                NSAlert(error: error).runModal()
            }
        }
    }

    private func showCharts() {
        popover.performClose(nil)
        if chartWindow == nil {
            let configuration = WKWebViewConfiguration()
            configuration.websiteDataStore = .nonPersistent()
            configuration.userContentController.add(self, name: "quota")
            let view = WKWebView(frame: .zero, configuration: configuration)
            view.navigationDelegate = self
            view.setAccessibilityIdentifier("quota-chart-webview")
            chartView = view
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 995, height: 760),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered, defer: false
            )
            window.title = "ResetCat · 完整额度图表"
            window.isReleasedWhenClosed = false
            window.contentView = view
            window.center()
            chartWindow = window
            view.loadFileURL(chartURL, allowingReadAccessTo: chartURL)
        }
        NSApp.activate(ignoringOtherApps: true)
        chartWindow?.makeKeyAndOrderFront(nil)
        updateCharts()
    }

    private func updateCharts() {
        guard chartReady, let chartView else { return }
        chartView.evaluateJavaScript("window.showQuotaBarState(" + model.chartState + ")") { _, error in
            if let error { NSLog("Unable to update quota chart: %@", error.localizedDescription) }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.webView === chartView, let action = message.body as? String else { return }
        switch action {
        case "ready": chartReady = true; updateCharts()
        case "import": chooseFile(watch: false)
        case "demo": model.showDemo(true)
        case "live": model.showDemo(false)
        case "clear": confirmClear()
        case "example": saveExample()
        case "copy-agent-guide": copyAgentText(template: false)
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL, url.standardizedFileURL == chartURL.standardizedFileURL {
            decisionHandler(.allow)
            return
        }
        if action.navigationType == .linkActivated && url.absoluteString == "https://resetcat.pages.dev/" {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
    }
}

do {
    guard let resource = Bundle.main.url(forResource: "quota-model", withExtension: "js"),
          let charts = Bundle.main.url(forResource: "quota", withExtension: "html") else {
        throw QuotaError(message: "应用缺少内置额度资源。")
    }
    let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ResetCat Quota Bar", isDirectory: true)
    let model = try QuotaModel(resource: resource, storage: folder.appendingPathComponent("snapshots.json"))
    let bar = QuotaBar(model: model, chartURL: charts)
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    application.delegate = bar
    withExtendedLifetime(bar) { application.run() }
} catch {
    let application = NSApplication.shared
    application.activate(ignoringOtherApps: true)
    NSAlert(error: error).runModal()
    exit(1)
}
