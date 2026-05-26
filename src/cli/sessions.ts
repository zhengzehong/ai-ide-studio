import type { Command } from 'commander'
import { getWsClient, getDirectStore } from './shared.js'

export function registerSessionCommands(program: Command) {
  const sessions = program.command('sessions').description('Session 管理')

  sessions
    .command('list')
    .description('列出所有 Session')
    .option('--agent <id>', '按 Agent 过滤')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = { type: 'sessions.list' }
        if (opts.agent) msg.agentId = opts.agent
        const data = await ws.request(msg) as Record<string, unknown>[]
        ws.close()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        if (data.length === 0) { console.log('暂无 Session'); return }
        console.log(`共 ${data.length} 个 Session:\n`)
        for (const s of data) {
          console.log(`  ${s.id}  agent=${s.agent_id}  status=${s.status}`)
        }
      } catch {
        const store = getDirectStore()
        const data = store.sessions()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        console.log('(Gateway 未运行)\n')
        for (const s of data) {
          console.log(`  ${s.id}  agent=${s.agent_id}  status=${s.status}`)
        }
      }
    })

  sessions
    .command('create')
    .description('创建新 Session')
    .requiredOption('--agent <id>', 'Agent ID')
    .option('--task <id>', '关联的 Task ID')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = { type: 'sessions.create', agentId: opts.agent }
        if (opts.task) msg.taskId = opts.task
        const session = await ws.request(msg)
        ws.close()
        if (opts.json) console.log(JSON.stringify(session, null, 2))
        else console.log(`Session 已创建: ${(session as Record<string, string>).id}`)
      } catch (err) {
        console.error('创建失败:', (err as Error).message)
      }
    })
}
