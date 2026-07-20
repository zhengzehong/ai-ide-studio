import { sessionTemplateStore, type SessionTemplateRow } from '../store/session-templates.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { agentStore } from '../store/agents.js'
import { acpHost } from '../acp/host.js'
import { events } from './events.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('session-templates')

export interface PublishSessionAsTemplateInput {
  sourceSessionId: string
  name: string
  description?: string
  icon?: string
}

export interface SessionTemplateProjectContext {
  projectId?: string
  cwd?: string
}

function resolveProjectContext(
  agentId: string,
  existingProjectId: string | null | undefined,
): SessionTemplateProjectContext {
  const agent = agentStore.get(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  const projectId = existingProjectId ?? agent.project_id ?? undefined
  if (!projectId) return {}
  return { projectId }
}

export const sessionTemplateManager = {
  async publishSessionAsTemplate(
    input: PublishSessionAsTemplateInput,
  ): Promise<SessionTemplateRow> {
    const source = sessionStore.get(input.sourceSessionId)
    if (!source) {
      throw new Error(`Session not found: ${input.sourceSessionId}`)
    }
    if (source.is_template) {
      throw new Error('不能把模板会话发布为模板')
    }
    if (source.status !== 'active') {
      throw new Error('源会话当前状态不允许发布为模板')
    }
    if (!source.acp_session_id) {
      throw new Error('该会话暂无可复制的上下文(可能从未启动过 Agent)')
    }

    const agent = agentStore.get(source.agent_id)
    if (!agent) throw new Error(`Agent not found: ${source.agent_id}`)

    const projectContext = resolveProjectContext(source.agent_id, source.project_id)

    const templateSession = sessionStore.create({
      agentId: source.agent_id,
      projectId: projectContext.projectId,
      isTemplate: true,
      title: input.name,
    })
    sessionStore.updateStage(templateSession.id, '正在生成模板会话...')

    let acpSessionId: string
    try {
      acpSessionId = await acpHost.forkSessionFromAcpSessionId(
        source.agent_id,
        source.acp_session_id,
        templateSession.id,
        projectContext,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await acpHost.closeSession(source.agent_id, templateSession.id).catch(() => undefined)
      sessionStore.delete(templateSession.id)
      log.error(
        { err, sourceSessionId: source.id, templateSessionId: templateSession.id },
        'publishSessionAsTemplate fork failed',
      )
      throw new Error(`发布模板失败:${message}`, { cause: err })
    }

    sessionStore.updateAcpSessionId(templateSession.id, acpSessionId)
    sessionStore.updateStage(templateSession.id, '')
    const updatedTemplateSession = sessionStore.get(templateSession.id)
    if (updatedTemplateSession) {
      events.emit('session:changed', { sessionId: templateSession.id, data: { ...updatedTemplateSession } })
    }

    const template = sessionTemplateStore.create({
      name: input.name,
      description: input.description ?? null,
      agentId: source.agent_id,
      projectId: projectContext.projectId ?? null,
      runtime: agent.runtime,
      sourceSessionId: source.id,
      templateSessionId: templateSession.id,
      icon: input.icon ?? null,
    })

    log.info(
      {
        templateId: template.id,
        sourceSessionId: source.id,
        templateSessionId: templateSession.id,
        agentId: source.agent_id,
      },
      'session template published',
    )
    return template
  },

  async instantiateSessionTemplate(templateId: string): Promise<SessionRow> {
    const template = sessionTemplateStore.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const templateSession = sessionStore.get(template.template_session_id)
    if (!templateSession || templateSession.deleted_at) {
      throw new Error(`模板会话不存在或已被删除: ${template.template_session_id}`)
    }
    if (!templateSession.acp_session_id) {
      throw new Error('模板会话暂无可复制的上下文(可能从未启动过 Agent)')
    }

    const projectContext = resolveProjectContext(template.agent_id, template.project_id)

    const newSession = sessionStore.create({
      agentId: template.agent_id,
      projectId: projectContext.projectId,
      isTemplate: false,
      title: `从模板新建:${template.name}`,
    })
    sessionStore.updateStage(newSession.id, '正在从模板新建...')

    let acpSessionId: string
    try {
      acpSessionId = await acpHost.forkSessionFromAcpSessionId(
        template.agent_id,
        templateSession.acp_session_id,
        newSession.id,
        projectContext,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await acpHost.closeSession(template.agent_id, newSession.id).catch(() => undefined)
      sessionStore.delete(newSession.id)
      log.error(
        { err, templateId, newSessionId: newSession.id },
        'instantiateSessionTemplate fork failed',
      )
      throw new Error(`从模板新建失败:${message}`, { cause: err })
    }

    sessionStore.updateAcpSessionId(newSession.id, acpSessionId)
    sessionStore.updateStage(newSession.id, '')
    sessionTemplateStore.incrementUseCount(templateId)

    const updated = sessionStore.get(newSession.id)
    if (!updated) throw new Error(`New session missing: ${newSession.id}`)
    events.emit('session:changed', { sessionId: newSession.id, data: { ...updated } })

    log.info(
      { templateId, newSessionId: newSession.id, agentId: template.agent_id },
      'session template instantiated',
    )
    return updated
  },

  async deleteTemplate(templateId: string): Promise<void> {
    const template = sessionTemplateStore.get(templateId)
    if (!template) {
      log.warn({ templateId }, 'deleteTemplate: template not found')
      return
    }

    const templateSession = sessionStore.get(template.template_session_id)
    if (templateSession) {
      try {
        await acpHost.closeSession(template.agent_id, template.template_session_id)
      } catch (err) {
        log.debug(
          { err, templateId, templateSessionId: template.template_session_id },
          'deleteTemplate: closeSession best-effort failed',
        )
      }
      sessionStore.delete(template.template_session_id)
      events.emit('session:changed', {
        sessionId: template.template_session_id,
        data: { event: 'deleted', deleted: true },
      })
    }

    sessionTemplateStore.delete(templateId)
    log.info({ templateId, templateSessionId: template.template_session_id }, 'session template deleted')
  },
}
