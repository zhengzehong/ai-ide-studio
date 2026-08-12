import type { CreateToolInput } from '../store/tools.js'

const KB_PERMISSIONS = { requiresApproval: false, maxExecutionTime: 10_000, networkAccess: false }

export const KB_BUILTIN_TOOLS: (CreateToolInput & { defaultScope: 'global' })[] = [
  createKnowledgeTool({
    name: 'core.kb.list',
    displayName: '列出知识库',
    description: '列出当前项目可见的知识库和页面目录，不返回正文。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  }),
  createKnowledgeTool({
    name: 'core.kb.read',
    displayName: '读取知识页面',
    description: '按页面 ID 读取当前项目可见的知识库页面。',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string', description: '页面 ID' } },
      required: ['pageId'],
      additionalProperties: false,
    },
  }),
  createKnowledgeTool({
    name: 'core.kb.upsert',
    displayName: '保存知识页面',
    description: '新增或修改知识库页面；传 pageId 时修改，否则新增。',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: { type: 'string', description: '新增页面所属的知识库 ID' },
        pageId: { type: 'string', description: '要修改的页面 ID' },
        title: { type: 'string', description: '页面标题' },
        section: { type: 'string', description: '页面分区' },
        summary: { type: 'string', description: '页面摘要' },
        body: { type: 'string', description: 'Markdown 正文' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      },
      additionalProperties: false,
    },
  }),
  createKnowledgeTool({
    name: 'core.kb.delete',
    displayName: '删除知识页面',
    description: '按页面 ID 软删除知识库页面；索引页不能删除。',
    inputSchema: {
      type: 'object',
      properties: { pageId: { type: 'string', description: '页面 ID' } },
      required: ['pageId'],
      additionalProperties: false,
    },
  }),
]

function createKnowledgeTool(input: {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
}): CreateToolInput & { defaultScope: 'global' } {
  return {
    ...input,
    category: 'data',
    type: 'builtin',
    config: { handler: input.name },
    permissions: KB_PERMISSIONS,
    isBuiltin: true,
    defaultScope: 'global',
  }
}
