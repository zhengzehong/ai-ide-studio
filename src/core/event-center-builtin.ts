import { eventCategoryStore } from '../store/event-categories.js'

export const TASK_LIFECYCLE_CATEGORY_ID = 'task.lifecycle'

export const TASK_LIFECYCLE_SCHEMA = {
  type: 'object',
  properties: {
    taskId: { type: 'string', title: '任务 ID' },
    taskTitle: { type: 'string', title: '任务' },
    taskStatus: {
      type: 'string',
      title: '任务状态',
      enum: ['draft', 'running', 'needs_input', 'completed', 'cancelled'],
      'x-list': true,
      'x-filter': true,
    },
    previousStatus: { type: 'string', title: '原状态', 'x-list': true },
    assignedAgentId: { type: 'string', title: '指派 Agent', 'x-list': true, 'x-filter': true },
    changeType: { type: 'string', title: '变更类型', 'x-list': true, 'x-filter': true },
    stage: { type: 'string', title: '阶段' },
    source: { type: 'string', title: '来源', 'x-filter': true },
    stepId: { type: 'string', title: '步骤 ID', 'x-filter': true },
  },
}

export function ensureBuiltinEventCategories(): void {
  if (eventCategoryStore.get(TASK_LIFECYCLE_CATEGORY_ID)) return
  eventCategoryStore.upsert({
    id: TASK_LIFECYCLE_CATEGORY_ID,
    name: '任务生命周期',
    description: '记录任务创建、指派、执行、阻塞、待审查、完成和取消等生命周期变化。',
    schema: TASK_LIFECYCLE_SCHEMA,
    defaultPriority: 'medium',
    allowedWriters: ['*'],
    allowedConsumers: ['*'],
    enabled: true,
  })
}
