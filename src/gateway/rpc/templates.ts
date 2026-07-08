import { templateStore } from '../../store/agent-templates.js'
import type { RpcHandlerMap } from './types.js'

export const templateRpcHandlers: RpcHandlerMap = {
  'templates.list'(_msg, { sendResult }) {
    sendResult(templateStore.list())
  },

  'templates.get'(msg, { sendResult }) {
    sendResult(templateStore.get(msg.templateId as string))
  },

  'templates.create'(msg, { sendResult }) {
    const tpl = templateStore.create({
      name: msg.name as string,
      type: msg.agentType as string,
      runtime: msg.runtime as string | undefined,
      icon: msg.icon as string | undefined,
      avatarUrl: msg.avatarUrl as string | null | undefined,
      systemPrompt: msg.systemPrompt as string | undefined,
      description: msg.description as string | undefined,
      skills: msg.skills as string[] | undefined,
    })
    sendResult(tpl)
  },

  'templates.update'(msg, { sendResult }) {
    const fields: Record<string, unknown> = {}
    if (msg.name !== undefined) fields.name = msg.name
    if (msg.agentType !== undefined) fields.type = msg.agentType
    if (msg.runtime !== undefined) fields.runtime = msg.runtime
    if (msg.icon !== undefined) fields.icon = msg.icon
    if (msg.avatarUrl !== undefined) fields.avatarUrl = msg.avatarUrl
    if (msg.systemPrompt !== undefined) fields.systemPrompt = msg.systemPrompt
    if (msg.description !== undefined) fields.description = msg.description
    if (msg.skills !== undefined) fields.skills = msg.skills
    sendResult(templateStore.update(msg.templateId as string, fields as never))
  },

  'templates.delete'(msg, { sendResult }) {
    templateStore.delete(msg.templateId as string)
    sendResult({ deleted: true })
  },
}
