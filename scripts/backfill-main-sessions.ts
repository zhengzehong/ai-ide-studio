import { resolve } from 'path'
import { initDatabase, closeDatabase } from '../src/store/db.js'
import { agentStore } from '../src/store/agents.js'
import { sessionStore } from '../src/store/sessions.js'

async function main(): Promise<void> {
  const dataDir = resolve(process.env.DATA_DIR || './data')
  const dbPath = resolve(dataDir, 'ai-ide.sqlite')
  initDatabase(dbPath)

  try {
    const agents = agentStore.list()
    let created = 0
    let skipped = 0
    for (const agent of agents) {
      const existing = sessionStore.findPrimaryByAgent(agent.id)
      if (existing) {
        skipped += 1
        continue
      }
      sessionStore.create({
        agentId: agent.id,
        projectId: agent.project_id ?? undefined,
        isPrimary: true,
        title: '主会话',
      })
      created += 1
      console.log(`为 Agent ${agent.name} (${agent.id}) 补建主会话`)
    }
    console.log(`\n完成:新建 ${created} 个,跳过 ${skipped} 个(已有主会话),共 ${agents.length} 个 Agent`)
  } finally {
    closeDatabase()
  }
}

main().catch((err) => {
  console.error('backfill 失败:', err)
  process.exit(1)
})
