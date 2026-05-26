import type { Command } from 'commander'
import { getWsClient, getDirectStore } from './shared.js'

export function registerTaskCommands(program: Command) {
  const tasks = program.command('tasks').description('任务管理')

  tasks
    .command('list')
    .description('列出所有任务')
    .option('--status <status>', '按状态过滤')
    .option('--json', 'JSON 格式输出')
    .action(async (opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = { type: 'tasks.list' }
        if (opts.status) msg.status = opts.status
        const data = await ws.request(msg) as Record<string, unknown>[]
        ws.close()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        if (data.length === 0) { console.log('暂无任务'); return }
        console.log(`共 ${data.length} 个任务:\n`)
        for (const t of data) {
          console.log(`  ${t.id}  ${t.title}  [${t.status}]  ${t.assigned_agent_id || '未指派'}`)
        }
      } catch {
        const store = getDirectStore()
        const data = store.tasks()
        if (opts.json) { console.log(JSON.stringify(data, null, 2)); return }
        console.log('(Gateway 未运行)\n')
        for (const t of data) {
          console.log(`  ${t.id}  ${t.title}  [${t.status}]`)
        }
      }
    })

  tasks
    .command('create <title>')
    .description('创建任务')
    .option('--assign <agentId>', '指派给 Agent（自动开始执行）')
    .option('--description <desc>', '任务描述')
    .option('--json', 'JSON 格式输出')
    .action(async (title, opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = { type: 'tasks.create', title }
        if (opts.assign) msg.assignAgentId = opts.assign
        if (opts.description) msg.description = opts.description
        const task = await ws.request(msg) as Record<string, unknown>
        ws.close()
        if (opts.json) { console.log(JSON.stringify(task, null, 2)); return }
        console.log(`任务已创建: ${task.id}`)
        console.log(`  标题:   ${task.title}`)
        console.log(`  状态:   ${task.status}`)
        if (task.sessionId) console.log(`  Session: ${task.sessionId}`)
        if (task.assigned_agent_id) console.log(`  Agent:   ${task.assigned_agent_id}`)
      } catch (err) {
        console.error('创建失败:', (err as Error).message)
      }
    })

  tasks
    .command('update <id>')
    .description('更新任务状态')
    .option('--status <status>', '新状态')
    .option('--stage <stage>', '阶段描述')
    .option('--json', 'JSON 格式输出')
    .action(async (id, opts) => {
      try {
        const ws = await getWsClient()
        const msg: Record<string, unknown> = { type: 'tasks.update', taskId: id }
        if (opts.status) msg.status = opts.status
        if (opts.stage) msg.stage = opts.stage
        const task = await ws.request(msg)
        ws.close()
        if (opts.json) console.log(JSON.stringify(task, null, 2))
        else console.log(`任务已更新: ${id}`)
      } catch (err) {
        console.error('更新失败:', (err as Error).message)
      }
    })
}
