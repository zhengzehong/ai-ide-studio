import { loadConfig } from './core/config.js'
import { createChildLogger } from './core/logger.js'
import { startApp } from './app.js'

const log = createChildLogger('entry')

async function main(): Promise<void> {
  const handle = await startApp(loadConfig())

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

main().catch((err) => {
  log.fatal({ err }, '启动失败')
  process.exit(1)
})
