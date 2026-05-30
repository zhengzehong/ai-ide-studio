import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const buildDir = process.env.AI_IDE_ELECTRON_BUILD_DIR ?? join(root, 'electron', 'dist')
const files = ['backend-launch.js', 'backend-main.js', 'builder.config.js', 'main.js', 'preload.js']

if (!existsSync(buildDir)) {
  throw new Error(`Electron build directory does not exist: ${buildDir}`)
}

for (const file of files) {
  const source = join(buildDir, file)
  if (!existsSync(source)) throw new Error(`Missing Electron build output: ${source}`)
}
