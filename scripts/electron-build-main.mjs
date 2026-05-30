import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const buildDir = process.env.AI_IDE_ELECTRON_BUILD_DIR || join(root, 'electron', 'dist')
mkdirSync(buildDir, { recursive: true })

const result = spawnSync('node', [
  'node_modules/typescript/bin/tsc',
  '-p',
  'tsconfig.electron.json',
  '--outDir',
  buildDir,
], {
  cwd: root,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: 'inherit',
})

if ((result.status ?? 1) !== 0) {
  const hint = process.platform === 'win32'
    ? '当前环境无法写入 electron/dist 时，可先设置 AI_IDE_ELECTRON_BUILD_DIR=%LOCALAPPDATA%\\Temp\\ai-ide-studio-electron-build 后重试。'
    : '当前环境无法写入 electron/dist 时，可先设置 AI_IDE_ELECTRON_BUILD_DIR=/tmp/ai-ide-studio-electron-build 后重试。'
  console.error(hint)
}

process.exit(result.status ?? 1)
