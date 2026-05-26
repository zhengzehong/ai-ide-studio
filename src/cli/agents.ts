import type { Command } from 'commander'
import { getWsClient, getDirectStore } from './shared.js'

export function registerAgentCommands(program: Command) {
  const agents = program.command('agents').description('Agent 管理')

  agents
    .command('list')
    .description('列出所有 Agent')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const data = await ws.request({ type: 'agents.list' }) as Record<string, unknown>[]
        ws.close()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        if (data.length === 0) { console.log('暂无 Agent'); return }
        console.log(`共 ${data.length} 个 Agent:\n`)
        for (const a of data) {
          console.log(`  ${a.id}  ${a.name}  ${a.runtime}  [${a.status}]`)
        }
      } catch {
        const store = getDirectStore()
        const data = store.agents()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        console.log('(Gateway 未运行，从本地数据读取)\n')
        for (const a of data) {
          console.log(`  ${a.id}  ${a.name}  ${a.runtime}  [${a.status}]`)
        }
      }
    })

  agents
    .command('create')
    .description('创建 Agent')
    .requiredOption('--name <name>', 'Agent 名称')
    .option('--type <type>', 'Agent 类型', 'dev')
    .option('--runtime <runtime>', 'Runtime', 'mock')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const agent = await ws.request({ type: 'agents.create', name: opts.name, agentType: opts.type, runtime: opts.runtime })
        ws.close()
        if (opts.json) console.log(JSON.stringify(agent, null, 2))
        else console.log(`Agent 已创建: ${(agent as Record<string, string>).id}`)
      } catch (err) {
        console.error('创建失败:', (err as Error).message)
      }
    })
}
