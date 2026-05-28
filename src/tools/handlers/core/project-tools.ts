import { projectStore } from '../../../store/projects.js'
import type { ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../../types.js'

export const listProjectsHandler: ToolHandler = {
  name: 'core.project.list',
  description: '列出平台项目',
  inputSchema: { type: 'object', properties: {} },
  async execute(): Promise<ToolHandlerResult> {
    return jsonResult({ projects: projectStore.list() })
  },
}

export const getProjectHandler: ToolHandler = {
  name: 'core.project.get',
  description: '获取项目详情',
  inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const projectId = requireString(input, 'projectId')
    const project = projectStore.get(projectId)
    if (!project) return errorResult(`项目不存在: ${projectId}`)
    return jsonResult({ project })
  },
}

export const createProjectHandler: ToolHandler = {
  name: 'core.project.create',
  description: '创建项目',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      workDir: { type: 'string' },
      description: { type: 'string' },
    },
    required: ['name', 'workDir'],
  },
  async execute(input: ToolHandlerInput): Promise<ToolHandlerResult> {
    const name = requireString(input, 'name').trim()
    const workDir = requireString(input, 'workDir').trim()
    if (!name) return errorResult('项目名称不能为空')
    if (!workDir) return errorResult('项目工作目录不能为空')
    const project = projectStore.create({ name, workDir, description: optionalString(input, 'description') })
    return jsonResult({ project })
  },
}

function requireString(input: ToolHandlerInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`${key} 必须是字符串`)
  return value
}

function optionalString(input: ToolHandlerInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

function jsonResult(value: unknown): ToolHandlerResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string): ToolHandlerResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
