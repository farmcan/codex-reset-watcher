import ServiceManagement
import SwiftUI

final class LoginItem: ObservableObject {
    @Published private(set) var status = SMAppService.mainApp.status
    @Published private(set) var error: String?

    var requested: Bool { status == .enabled || status == .requiresApproval }
    var needsApproval: Bool { status == .requiresApproval }

    var label: String {
        switch status {
        case .enabled: return "已启用"
        case .requiresApproval: return "等待系统批准"
        case .notRegistered: return "未启用"
        case .notFound: return "系统尚未识别应用"
        @unknown default: return "状态未知"
        }
    }

    func reload() {
        let current = SMAppService.mainApp.status
        if current != status { status = current }
    }

    func setEnabled(_ enabled: Bool) {
        reload()
        guard enabled != requested else { return }
        error = nil
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            self.error = enabled ? "启用登录启动失败。请从「应用程序」打开后重试。" : "取消登录启动失败，请在系统设置检查。"
        }
        reload()
    }

    func openSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }
}
