import { loadConfig } from './core/config.js'
import { initDatabase } from './store/db.js'
import { agentStore } from './store/agents.js'
import { startGateway } from './gateway/server.js'
import { ruleEngine } from './core/rules.js'
import { resolve } from 'path'

async function main() {
  const config = loadConfig()

  const dbPath = resolve(config.dataDir, 'ai-ide.sqlite')
  initDatabase(dbPath)
  console.log(`[DB] 数据库已初始化: ${dbPath}`)

  seedDefaultAgents()

  const { server } = await startGateway(config)
  ruleEngine.start()
  console.log(`[Gateway] 服务已启动: http://localhost:${config.port}`)
  console.log(`[Gateway] WebSocket: ws://localhost:${config.port}`)
  console.log(`[Gateway] 健康检查: http://localhost:${config.port}/health`)

  process.on('SIGINT', () => {
    console.log('\n[Gateway] 正在关闭...')
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
  console.log(`[Seed] 默认 Agent 已初始化 (${defaults.length} 个)`)
}

main().catch((err) => {
  console.error('启动失败:', err)
  process.exit(1)
})
