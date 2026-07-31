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

void startUi()
