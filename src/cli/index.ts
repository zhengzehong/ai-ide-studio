import { Command } from 'commander'
import { registerAgentCommands } from './agents.js'
import { registerSessionCommands } from './sessions.js'
import { registerTaskCommands } from './tasks.js'
import { registerRuleCommands } from './rules.js'

const program = new Command()

program
  .name('ai-ide')
  .version('0.2.0')
  .description('AI IDE Studio 命令行工具')

registerAgentCommands(program)
registerSessionCommands(program)
registerTaskCommands(program)
registerRuleCommands(program)

program
  .command('status')
  .description('查看系统状态')
  .option('--json', 'JSON 格式输出')
  .action(async (opts) => {
    const { getWsClient, getDirectStore } = await import('./shared.js')
    try {
      const ws = await getWsClient()
      const agents = await ws.request({ type: 'agents.list' }) as unknown[]
      const sessions = await ws.request({ type: 'sessions.list' }) as unknown[]
      const tasks = await ws.request({ type: 'tasks.list' }) as unknown[]
      ws.close()

      const status = {
        connected: true,
        agents: agents.length,
        sessions: sessions.length,
        tasks: tasks.length,
        runningAgents: (agents as Record<string, string>[]).filter(a => a.status === 'running').length,
        activeSessions: (sessions as Record<string, string>[]).filter(s => s.status === 'active').length,
      }
      if (opts.json) console.log(JSON.stringify(status, null, 2))
      else {
        console.log('AI IDE Studio 状态:')
        console.log(`  Gateway:       已连接`)
        console.log(`  Agents:        ${status.agents} 个 (${status.runningAgents} 运行中)`)
        console.log(`  Sessions:      ${status.sessions} 个 (${status.activeSessions} 活跃)`)
        console.log(`  Tasks:         ${status.tasks} 个`)
      }
    } catch {
      const store = getDirectStore()
      if (opts.json) console.log(JSON.stringify({ connected: false, message: 'Gateway 未运行，从本地数据读取' }))
      else {
        console.log('AI IDE Studio 状态:')
        console.log('  Gateway:       未运行')
        console.log(`  Agents (本地): ${store.agents().length} 个`)
        console.log(`  Tasks (本地):  ${store.tasks().length} 个`)
      }
    }
  })

program.parse()
