import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateElectronModules } from './electron-package-integrity.mjs'

const root = process.cwd()
const buildDir = process.env.AI_IDE_ELECTRON_BUILD_DIR ?? join(root, 'electron', 'dist')
const files = [
  'backend-launch.js',
  'backend-main.js',
  'builder.config.js',
  'desktop-connection-probe.js',
  'desktop-connection.js',
  'desktop-credentials.js',
  'desktop-icon.js',
  'desktop-ipc.js',
  'desktop-ipc-policy.js',
  'desktop-preload.cjs',
  'desktop-security.js',
  'desktop-target.js',
  'desktop-window-settings.js',
  'main.js',
  'main-window-exit.js',
  'main-window-navigation.js',
  'load-recovery.js',
  'setup-preload.cjs',
  'setup-submission.js',
  'setup-window.js',
  'widget-preload.cjs',
  'widget-navigation.js',
  'widget-window-layout.js',
  'widget-window.js',
]

if (!existsSync(buildDir)) {
  throw new Error(`Electron build directory does not exist: ${buildDir}`)
}

for (const file of files) {
  const source = join(buildDir, file)
  if (!existsSync(source)) throw new Error(`Missing Electron build output: ${source}`)
}
// backend-main is relocated next to the server dist directory by extraResources.
validateElectronModules(buildDir, { exclude: ['backend-main.js'] })
