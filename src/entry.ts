import { loadConfig } from './core/config.js'
import { initDatabase } from './store/db.js'
import { agentStore } from './store/agents.js'
import { seedBuiltinTemplates } from './store/agent-templates.js'
import { seedBuiltinTools } from './tools/seed.js'
import { startGateway } from './gateway/server.js'
import { ruleEngine } from './core/rules.js'
import { createChildLogger } from './core/logger.js'
import { resolve } from 'path'

const log = createChildLogger('entry')

async function main() {
  const config = loadConfig()

  const dbPath = resolve(config.dataDir, 'ai-ide.sqlite')
  initDatabase(dbPath)
  log.info({ dbPath }, '数据库已初始化')

  seedDefaultAgents()
  seedBuiltinTemplates()
  seedBuiltinTools()

  const { server } = await startGateway(config)
  ruleEngine.start()
  log.info(
    { port: config.port, http: `http://localhost:${config.port}`, ws: `ws://localhost:${config.port}` },
    '服务已启动',
  )

  process.on('SIGINT', () => {
    log.info('收到 SIGINT，正在关闭...')
    ruleEngine.stop()
    server.close()
    process.exit(0)
  })
}

function seedDefaultAgents() {
  const defaults = [
    { id: 'claude-dev', type: 'dev', name: 'Claude (开发)', runtime: 'claude' },
    { id: 'codex-dev', type: 'dev', name: 'Codex (开发)', runtime: 'codex' },
    { id: 'mock-dev', type: 'dev', name: 'Mock (测试)', runtime: 'mock' },
  ]

  for (const def of defaults) {
    agentStore.upsert(def)
  }
  log.info({ count: defaults.length }, '默认 Agent 已初始化')
}

main().catch((err) => {
  log.fatal({ err }, '启动失败')
  process.exit(1)
})
