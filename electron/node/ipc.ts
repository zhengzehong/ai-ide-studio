import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { DesktopRuntimeTarget } from '../desktop-target.js'
import { createDesktopCredentialProtector } from '../desktop-credentials.js'
import { isDesktopApplicationPath, isTrustedDesktopIpcSender } from '../desktop-ipc-policy.js'
import { NodeController } from './controller.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('ipc')

export function registerNodeIpc(window: BrowserWindow, target: DesktopRuntimeTarget, userDataDir: string): void {
  const controller = new NodeController(target, join(userDataDir, 'execution-node'), createDesktopCredentialProtector(),
    { desktop: app.getPath('desktop'), downloads: app.getPath('downloads') })
  const assertSender = (event: IpcMainInvokeEvent): void => {
    if (!isTrustedDesktopIpcSender({ senderId: event.sender.id, allowedSenderIds: new Set([window.webContents.id]),
      isMainFrame: event.senderFrame === event.sender.mainFrame, frameUrl: event.senderFrame?.url ?? '',
      allowedOrigin: target.origin, allowedPath: isDesktopApplicationPath })) throw new Error('不允许此页面访问设备设置')
  }
  ipcMain.handle('node:status', (event) => { assertSender(event); return controller.status() })
  ipcMain.handle('node:enable', async (event, enabled: unknown) => {
    assertSender(event)
    if (typeof enabled !== 'boolean') throw new Error('启用状态无效')
    if (enabled && !controller.status().enabled) {
      const result = await dialog.showMessageBox(window, {
        type: 'warning', title: '允许 AI 操作这台电脑？',
        message: '启用后，服务器上的 AI 可以在这台电脑执行命令并读写文件。',
        detail: `服务器：${target.origin}\n操作使用当前 Windows 用户权限，不逐条弹窗确认。关闭此开关可停止访问。`,
        buttons: ['取消', '允许访问'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (result.response !== 1) return controller.status()
    }
    return controller.setEnabled(enabled)
  })
  ipcMain.handle('node:unpair', async (event) => { assertSender(event); return controller.unpair() })
  ipcMain.handle('node:origin-proof', (event, input: unknown) => {
    assertSender(event)
    if (!input || typeof input !== 'object' || !('sessionId' in input) || !('messageId' in input)
      || typeof input.sessionId !== 'string' || typeof input.messageId !== 'string') throw new Error('来源签名请求无效')
    return controller.originProof(input.sessionId, input.messageId)
  })
  let closing = false
  let closed = false
  app.on('before-quit', (event) => {
    if (closed) return
    event.preventDefault()
    if (closing) return
    closing = true
    void controller.close().catch((err: unknown) => log.error({ err }, '退出时停止设备作业失败')).finally(() => {
      closed = true
      app.quit()
    })
  })
}
