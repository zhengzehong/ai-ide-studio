import { loadConfig, type AppConfig } from './core/config.js'
import { startUnifiedService } from './edge/supervisor.js'
import { createChildLogger } from './shared/logger.js'

const log = createChildLogger('entry')

async function main(): Promise<void> {
  const config = loadConfig()
  const handle = config.edgeMode === 'disabled'
    ? await startDirectService(config)
    : await startUnifiedService(config)
  let stopping = false

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    log.info({ signal }, '收到退出信号，正在关闭...')
    try {
      await handle.close()
      process.exit(0)
    } catch (err) {
      log.error({ err, signal }, '关闭失败')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => { void shutdown('SIGINT') })
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
}

async function startDirectService(config: AppConfig): Promise<{ close(): Promise<void> }> {
  const { startApp } = await import('./app.js')
  const app = await startApp(config)
  return { close: () => app.stop() }
}

main().catch((err) => {
  log.fatal({ err }, '启动失败')
  process.exit(1)
})
