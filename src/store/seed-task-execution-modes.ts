import { taskExecutionModeStore, type CreateTaskExecutionModeInput } from '../store/task-execution-modes.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('seed:task-execution-modes')

const BUILTIN_MODES: Array<CreateTaskExecutionModeInput & { id: string }> = [
  {
    id: 'temode-default',
    name: '默认执行',
    description: '直接执行任务,完成后汇报',
    promptTemplate: '',
    reportTemplate: '## 本轮工作\n- 完成了什么\n## 下一步计划\n- 接下来要做什么\n## 问题/总结\n- 需要确认的问题或完成总结',
    isBuiltin: true,
    sortOrder: 0,
  },
  {
    id: 'temode-bug-fix',
    name: '问题修复',
    description: '先定位根因,汇报方案,确认后修复,再汇报结果',
    promptTemplate: `本任务为「问题修复」模式,请按以下流程执行:
1. 复现/分析问题,定位根本原因(不是表面症状)
2. 调用 studio.task.report(agentStatus="done") 汇报:根因分析 + 修复方案 + 影响范围,等待人工确认
3. 人工确认后,执行修复
4. 验证修复效果(自测/测试用例)
5. 调用 studio.task.report(agentStatus="done") 汇报:修复内容 + 验证结果 + 涉及文件
注意:第 2 步未确认前不要修改代码。`,
    reportTemplate: '## 根因分析\n- 问题根因\n## 修复方案\n- 计划如何修复\n## 影响范围\n- 涉及哪些模块/文件\n## 验证结果\n- 修复后验证情况(末次汇报用)',
    isBuiltin: true,
    sortOrder: 1,
  },
  {
    id: 'temode-plan-first',
    name: '规划先行',
    description: '先输出详细规划,确认后执行,再汇报结果',
    promptTemplate: `本任务为「规划先行」模式,请按以下流程执行:
1. 理解需求,拆解任务,评估技术方案和风险
2. 调用 studio.task.report(agentStatus="done") 汇报:目标拆解 + 执行步骤 + 风险点,等待人工确认
3. 人工确认后,按规划逐步执行
4. 每完成一个里程碑可调用 studio.task.report(agentStatus="milestone") 同步进展
5. 全部完成后调用 studio.task.report(agentStatus="done") 汇报最终结果
注意:第 2 步未确认前不要开始执行。`,
    reportTemplate: '## 目标拆解\n- 子任务列表\n## 执行步骤\n- 每步的产出\n## 风险点\n- 可能的问题和应对\n## 完成总结\n- 最终成果(末次汇报用)',
    isBuiltin: true,
    sortOrder: 2,
  },
]

export function seedBuiltinTaskExecutionModes(): void {
  for (const mode of BUILTIN_MODES) {
    const existing = taskExecutionModeStore.get(mode.id)
    if (existing) {
      taskExecutionModeStore.update(mode.id, {
        name: mode.name,
        description: mode.description ?? null,
        promptTemplate: mode.promptTemplate,
        reportTemplate: mode.reportTemplate,
        sortOrder: mode.sortOrder,
      })
    } else {
      taskExecutionModeStore.create(mode)
    }
  }
  log.info({ count: BUILTIN_MODES.length }, '内置任务执行模式已就绪')
}
