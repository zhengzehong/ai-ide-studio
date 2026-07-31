import { BrowserWindow, ipcMain } from 'electron'
import type { DesktopConnectionInput } from './desktop-connection.js'
import { runDesktopSetupSubmission } from './setup-submission.js'

interface SetupWindowOptions {
  preloadPath: string
  iconPath?: string
  validateRemote: (origin: string, token: string) => Promise<void>
}

let activeSetupWindow: BrowserWindow | null = null

export function closeDesktopSetupWindow(): void {
  const window = activeSetupWindow
  if (window && !window.isDestroyed()) window.close()
  activeSetupWindow = null
}

export function showDesktopSetupWindow(options: SetupWindowOptions): Promise<DesktopConnectionInput> {
  return new Promise((resolve, reject) => {
    closeDesktopSetupWindow()
    const window = new BrowserWindow({
      width: 620,
      height: 620,
      minWidth: 560,
      minHeight: 560,
      resizable: true,
      title: 'AI IDE Studio',
      icon: options.iconPath,
      webPreferences: {
        preload: options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    activeSetupWindow = window
    let completed = false
    ipcMain.handle('desktop:first-run-submit', async (event, input: DesktopConnectionInput) => {
      try {
        if (event.sender.id !== window.webContents.id || event.senderFrame !== event.sender.mainFrame) {
          throw new Error('不允许从当前页面修改桌面连接')
        }
        if (input.mode === 'remote') {
          await options.validateRemote(input.remoteOrigin ?? '', input.token ?? '')
        }
        completed = true
        resolve(input)
        setImmediate(() => {
          if (!window.isDestroyed()) window.hide()
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
    window.on('closed', () => {
      if (activeSetupWindow === window) activeSetupWindow = null
      ipcMain.removeHandler('desktop:first-run-submit')
      if (!completed) reject(new Error('首次启动设置已取消'))
    })
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SETUP_HTML)}`)
  })
}

const SETUP_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>AI IDE Studio</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
    * { box-sizing: border-box; letter-spacing: 0; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 28px; }
    main { width: min(520px, 100%); }
    h1 { margin: 0; font-size: 28px; } p { color: #6b7280; margin: 8px 0 24px; }
    .modes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mode { border: 1px solid #d1d5db; background: #fff; border-radius: 8px; padding: 16px; cursor: pointer; }
    .mode:has(input:checked) { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
    .mode input { margin: 0 8px 0 0; } .mode strong { font-size: 15px; }
    .mode span { display: block; margin: 7px 0 0 22px; color: #6b7280; font-size: 13px; line-height: 1.5; }
    .remote { margin-top: 18px; display: none; gap: 12px; } .remote.visible { display: grid; }
    label.field { display: grid; gap: 6px; font-weight: 600; font-size: 14px; }
    input[type=text], input[type=password] { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; font: inherit; }
    .widget { display: flex; align-items: center; gap: 9px; margin-top: 20px; font-size: 14px; }
    .error { min-height: 21px; color: #dc2626; font-size: 13px; margin-top: 14px; }
    button { width: 100%; height: 42px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; font-weight: 600; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
  </style>
</head>
<body>
  <main>
    <h1>连接 AI IDE Studio</h1>
    <p>选择此桌面客户端启动时使用的服务。</p>
    <form id="form">
      <div class="modes">
        <label class="mode"><input type="radio" name="mode" value="managed-local" checked><strong>本机一体化</strong><span>启动内置服务和本机 Runtime。</span></label>
        <label class="mode"><input type="radio" name="mode" value="remote"><strong>远程服务器</strong><span>作为 Client 连接已部署的服务。</span></label>
      </div>
      <div id="remote" class="remote">
        <label class="field">服务器地址<input id="origin" type="text" placeholder="https://ide.example.com"></label>
        <label class="field">访问密钥<input id="token" type="password" autocomplete="off"></label>
      </div>
      <label class="widget"><input id="widget" type="checkbox" checked>启用桌面 Widget</label>
      <div id="error" class="error" role="alert"></div>
      <button id="submit" type="submit">继续</button>
    </form>
  </main>
  <script>
    const form = document.getElementById('form');
    const remote = document.getElementById('remote');
    const error = document.getElementById('error');
    const submit = document.getElementById('submit');
    document.querySelectorAll('input[name=mode]').forEach((input) => input.addEventListener('change', () => {
      remote.classList.toggle('visible', input.value === 'remote' && input.checked);
    }));
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); error.textContent = ''; submit.disabled = true; submit.textContent = '正在连接...';
      const mode = document.querySelector('input[name=mode]:checked').value;
      try {
        const result = await runDesktopSetupSubmission(window.electronSetup?.submit, {
          mode,
          remoteOrigin: document.getElementById('origin').value,
          token: document.getElementById('token').value,
          widgetEnabled: document.getElementById('widget').checked,
        });
        if (!result.ok) throw new Error(result.error || '设置失败');
      } catch (submitError) {
        error.textContent = submitError instanceof Error ? submitError.message : String(submitError);
      } finally {
        submit.disabled = false;
        submit.textContent = '继续';
      }
    });
  </script>
</body>
</html>`.replace(
  '<script>',
  `<script>\n    ${runDesktopSetupSubmission.toString()}`,
)
