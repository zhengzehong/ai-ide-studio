import type { Command } from 'commander'
import { getWsClient, getDirectStore } from './shared.js'
import type { RuleRow } from '../store/rules.js'

export function registerRuleCommands(program: Command) {
  const rules = program.command('rules').description('自动化规则管理')

  rules
    .command('list')
    .description('列出所有规则')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const data = await ws.request({ type: 'rules.list' }) as RuleRow[]
        ws.close()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        if (data.length === 0) { console.log('暂无自动化规则'); return }
        console.log(`共 ${data.length} 条规则:\n`)
        for (const r of data) {
          const status = r.enabled ? '启用' : '禁用'
          const lastRun = r.last_run_at ? new Date(r.last_run_at).toLocaleString('zh-CN') : '从未'
          console.log(`  ${r.id}  ${r.name}  [${status}]  运行 ${r.run_count} 次  上次: ${lastRun}`)
          console.log(`    cron: ${r.cron}  →  "${r.action_config.title}"`)
        }
      } catch {
        const store = getDirectStore()
        const data = store.rules()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        console.log('(Gateway 未运行)\n')
        for (const r of data) {
          console.log(`  ${r.id}  ${r.name}  cron=${r.cron}`)
        }
      }
    })

  rules
    .command('create <name>')
    .description('创建规则')
    .requiredOption('--cron <cron>', 'Cron 表达式 (5 字段)')
    .requiredOption('--title <title>', '触发时创建的任务标题')
    .option('--assign <agentId>', '指派给 Agent')
    .option('--description <desc>', '规则描述')
    .option('--json', 'JSON 格式输出')
    .action(async (name, opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = {
          type: 'rules.create',
          name,
          cron: opts.cron,
          action: 'create_task',
          actionConfig: {
            title: opts.title,
            description: opts.description,
            assignAgentId: opts.assign,
          },
          description: opts.description,
        }
        const rule = await ws.request(msg) as Record<string, unknown>
        ws.close()
        if (opts.json) { console.log(JSON.stringify(rule, null, 2)); return }
        console.log(`规则已创建: ${rule.id}`)
        console.log(`  名称:   ${rule.name}`)
        console.log(`  Cron:   ${rule.cron}`)
        console.log(`  任务:   ${(rule.action_config as Record<string, unknown>).title}`)
      } catch (err) {
        console.error('创建失败:', (err as Error).message)
      }
    })
}
