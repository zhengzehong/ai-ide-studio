import { existsSync } from 'fs'
import { resolve } from 'path'
import { loadConfig } from '../dist/core/config.js'
import { createChildLogger } from '../dist/core/logger.js'
import { startApp } from '../dist/app.js'

const log = createChildLogger('electron-backend')

async function main(): Promise<void> {
  const handle = await startApp(loadElectronConfig())

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, '收到退出信号，正在关闭...')
    try {
      await handle.stop()
      process.exit(0)
    } catch (err) {
      log.error({ err, signal }, '关闭失败')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

function loadElectronConfig() {
  const config = loadConfig()
  const staticDir = config.staticDir && existsSync(config.staticDir)
    ? config.staticDir
    : resolve('./resources/app/ui/dist')

  return {
    ...config,
    staticDir,
  }
}

main().catch((err) => {
  log.fatal({ err }, '启动失败')
  process.exit(1)
})
