import type { Migration } from '../migrator.js'

const FORMAL_CODE_MERGE_SCHEMA = {
  additionalProperties: false,
  type: 'object',
  properties: {
    acceptanceCriteria: {
      type: 'array',
      items: { type: 'string' },
      description: '验收清单,审查 Agent 必须逐项验证',
    },
    branchName: {
      type: 'string',
      description: '待合并的分支名,如 worktree-dev-pc',
      'x-filter': true,
    },
    commitHash: {
      type: 'string',
      description: '待审查的 commit hash',
    },
    reviewRound: {
      type: 'number',
      description: '审查轮次,首次为 1,每次 changes_requested 后 +1',
    },
    sourceAgentId: {
      type: 'string',
      description: '发起合并请求的开发 Agent ID',
      'x-filter': true,
    },
    sourceSessionId: {
      type: 'string',
      description: '开发 Agent 的会话 ID,审查结果回传到此会话',
    },
    status: {
      type: 'string',
      enum: ['pending', 'approved', 'changes_requested', 'error'],
      description: '审查状态:pending(待审)/ approved(通过)/ changes_requested(需改)/ error(异常)',
      'x-filter': true,
      'x-list': true,
      default: 'pending',
    },
    taskId: {
      type: 'string',
      description: '关联任务 ID',
      'x-filter': true,
    },
    worktreePath: {
      type: 'string',
      description: '代码所在 worktree 路径',
    },
  },
  required: ['sourceAgentId', 'sourceSessionId', 'worktreePath', 'branchName', 'commitHash', 'acceptanceCriteria', 'status'],
}

export const formalCodeMergeSchemaMigration: Migration = {
  version: '030',
  name: 'formal-code-merge-schema',
  up(db) {
    db.prepare(`
      UPDATE event_categories
      SET schema_json = ?, updated_at = ?
      WHERE id = 'formal.code.merge'
    `).run(JSON.stringify(FORMAL_CODE_MERGE_SCHEMA), new Date().toISOString())
  },
}
