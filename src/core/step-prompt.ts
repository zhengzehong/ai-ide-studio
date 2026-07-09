import { taskStore } from '../store/tasks.js'
import { taskStepStore, getStepReports, type TaskStepRow } from '../store/task-steps.js'
import type { StepArtifact } from './task-steps.js'

function describeStepStatusForPrompt(step: TaskStepRow, isSelf: boolean): string {
  const tag = isSelf ? `${step.status} ← 你在这里` : step.status
  return tag
}

export function buildStepPrompt(taskId: string, stepId: string): string {
  const task = taskStore.get(taskId)
  if (!task) throw new Error(`任务不存在: ${taskId}`)
  const step = taskStepStore.get(stepId)
  if (!step || step.task_id !== taskId) throw new Error(`步骤不存在: ${stepId}`)

  const allSteps = taskStepStore.listByTask(taskId)
  const snapshotLines = allSteps.map((s, idx) => {
    const me = s.id === stepId
    const mark = me ? ' ← 你在这里' : ''
    return `${idx + 1}. ${s.title} [${describeStepStatusForPrompt(s, me)}]${mark}`
  })

  const upstreamDeps = taskStepStore.listDependencies(stepId)
  const upstreamSections: string[] = []
  for (const upId of upstreamDeps) {
    const up = taskStepStore.get(upId)
    if (!up) continue
    const reports = getStepReports(taskId, upId)
    const latest = reports[reports.length - 1]
    if (!latest) {
      upstreamSections.push(`- 上游步骤 #${upId} ${up.title}: (无汇报)`)
      continue
    }
    const payload = parsePayload(latest.payload_json)
    const md = typeof payload.reportMd === 'string' ? payload.reportMd : ''
    const preview = md.slice(0, 200)
    const artifacts = Array.isArray(payload.artifacts)
      ? (payload.artifacts as StepArtifact[]).map(a => `${a.type}:${a.value}`).join(', ')
      : '无'
    upstreamSections.push(`- 上游步骤 #${upId} ${up.title}: ${preview || '(无报告)'}\n  artifacts: ${artifacts}`)
  }

  const parts: string[] = []
  parts.push('你是被步骤派发唤醒的 Agent。\n')
  parts.push(`【任务】#${taskId} ${task.title}`)
  parts.push(task.description || '(无任务目标文档)')
  parts.push('')
  parts.push('【步骤图当前状态】')
  parts.push(snapshotLines.join('\n'))
  parts.push('')
  parts.push(`【你的步骤】#${stepId} ${step.title}`)
  parts.push(step.description || '(无步骤说明)')
  parts.push(`当前进度:${step.current_stage || '尚未开始'}`)
  if (upstreamSections.length > 0) {
    parts.push('')
    parts.push('【上游产出摘要】')
    parts.push(upstreamSections.join('\n'))
    parts.push('(可调 task.step.get(taskId, stepId) 拉完整报告)')
  }
  parts.push('')
  parts.push('【可用工具】')
  parts.push(`- task.step.updateProgress(taskId, stepId, stage) —— 更新一句话进度`)
  parts.push(`- task.step.report(taskId, stepId, agentStatus, reportMd, artifacts?) —— 汇报(milestone/blocked/done)`)
  parts.push(`- task.get(taskId) —— 看任务全貌`)
  parts.push(`- task.step.get(taskId, stepId) —— 看任意步骤详情(含上游产出)`)
  parts.push('')
  parts.push('【执行要求】')
  parts.push(`1. 每次调用工具必须带 taskId=${taskId} 和 stepId=${stepId}`)
  parts.push('2. 关键节点用 report(milestone),完成用 report(done),卡住用 report(blocked)')
  parts.push('3. report 的 reportMd 要写完整:做了什么/改动详情/验证结果/下一步')
  parts.push('4. 任务在 draft 状态时 report 不解锁下游,需 PM task.start 后才继续')

  return parts.join('\n')
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
