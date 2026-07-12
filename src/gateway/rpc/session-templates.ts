import { sessionTemplateStore } from '../../store/session-templates.js'
import { sessionTemplateManager } from '../../core/session-templates.js'
import type { RpcHandlerMap } from './types.js'

export const sessionTemplateRpcHandlers: RpcHandlerMap = {
  'session_templates.list'(msg, { sendResult }) {
    const filter = {
      agentId: typeof msg.agentId === 'string' ? msg.agentId : undefined,
      projectId: typeof msg.projectId === 'string' ? msg.projectId : undefined,
    }
    sendResult(sessionTemplateStore.list(filter))
  },

  'session_templates.get'(msg, { sendResult }) {
    const templateId = msg.templateId as string
    const template = sessionTemplateStore.get(templateId)
    if (!template) throw new Error(`模板不存在: ${templateId}`)
    sendResult(template)
  },

  async 'session_templates.publish'(msg, { sendResult }) {
    const sourceSessionId = msg.sourceSessionId as string
    const name = msg.name as string
    if (!sourceSessionId) throw new Error('sourceSessionId is required')
    if (!name || !name.trim()) throw new Error('name is required')
    const description = typeof msg.description === 'string' ? msg.description : undefined
    const icon = typeof msg.icon === 'string' ? msg.icon : undefined
    const template = await sessionTemplateManager.publishSessionAsTemplate({
      sourceSessionId,
      name: name.trim(),
      description,
      icon,
    })
    sendResult(template)
  },

  async 'session_templates.instantiate'(msg, { sendResult }) {
    const templateId = msg.templateId as string
    if (!templateId) throw new Error('templateId is required')
    const session = await sessionTemplateManager.instantiateSessionTemplate(templateId)
    sendResult(session)
  },

  'session_templates.update'(msg, { sendResult }) {
    const templateId = msg.templateId as string
    if (!templateId) throw new Error('templateId is required')
    const fields: { name?: string; description?: string | null; icon?: string | null } = {}
    if (typeof msg.name === 'string') fields.name = msg.name
    if (msg.description !== undefined) fields.description = typeof msg.description === 'string' ? msg.description : null
    if (msg.icon !== undefined) fields.icon = typeof msg.icon === 'string' ? msg.icon : null
    const updated = sessionTemplateStore.update(templateId, fields)
    if (!updated) throw new Error(`模板不存在: ${templateId}`)
    sendResult(updated)
  },

  async 'session_templates.delete'(msg, { sendResult }) {
    const templateId = msg.templateId as string
    if (!templateId) throw new Error('templateId is required')
    await sessionTemplateManager.deleteTemplate(templateId)
    sendResult({ deleted: true })
  },
}
