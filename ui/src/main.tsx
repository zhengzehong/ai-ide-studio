import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { bootstrapUiData } from './bootstrap'
import { initializeDesktopRendererConnection } from './services/electron-desktop'

performance.mark('ai-ide-bootstrap-start')

if (window.location.pathname === '/widget') {
  document.documentElement.classList.add('widget-document')
}

async function startUi(): Promise<void> {
  initializeDesktopRendererConnection()
  await bootstrapUiData()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

function renderStartupError(): void {
  const root = document.getElementById('root')
  if (!root) return
  createRoot(root).render(
    <main className="startup-error" role="alert">
      <strong>页面启动失败</strong>
      <p>可能是服务更新或网络连接中断，请重新加载。</p>
      <button type="button" onClick={() => window.location.reload()}>重新加载</button>
    </main>,
  )
}

void startUi().catch(renderStartupError)
