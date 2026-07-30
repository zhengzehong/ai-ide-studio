import { sessionTemplateStore, type SessionTemplateRow } from '../store/session-templates.js'
import { sessionStore, type SessionRow } from '../store/sessions.js'
import { agentStore } from '../store/agents.js'
import { projectStore } from '../store/projects.js'
import { buildAgentRuntimeEnv } from '../acp/model-profile-env.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { buildRuntimeStateSnapshot } from '../runtime/api/runtime-snapshot.js'
import {
  cloneClaudeSessionFiles,
  hasClaudeSessionFiles,
  removeClaudeSessionFiles,
} from '../acp/claude-session-files.js'
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
  return {
    projectId,
    cwd: projectStore.get(projectId)?.work_dir ?? process.cwd(),
  }
}

function resolveClaudeStorageContext(session: SessionRow): { cwd: string; configDir?: string } {
  const agent = agentStore.get(session.agent_id)
  const projectId = session.project_id ?? agent?.project_id
  const cwd = projectId ? projectStore.get(projectId)?.work_dir ?? process.cwd() : process.cwd()
  const configDir = agent
    ? buildAgentRuntimeEnv(agent.runtime, agent).env.CLAUDE_CONFIG_DIR
    : process.env.CLAUDE_CONFIG_DIR
  return {
    cwd,
    configDir,
  }
}

async function ensureClaudeTemplateSnapshot(
  template: SessionTemplateRow,
  templateSession: SessionRow,
): Promise<void> {
  if (template.runtime !== 'claude') return
  if (!templateSession.acp_session_id) {
    throw new Error('模板会话缺少 ACP 会话 ID，无法修复快照')
  }

  const templateStorage = resolveClaudeStorageContext(templateSession)
  if (await hasClaudeSessionFiles({
    sessionId: templateSession.acp_session_id,
    ...templateStorage,
  })) return

  const sourceSession = sessionStore.get(template.source_session_id)
  if (!sourceSession?.acp_session_id) {
    throw new Error('模板快照缺失且源会话不可恢复，请重新发布模板')
  }

  const sourceStorage = resolveClaudeStorageContext(sourceSession)
  if (!await hasClaudeSessionFiles({ sessionId: sourceSession.acp_session_id, ...sourceStorage })) {
    throw new Error('模板快照缺失且源会话不可恢复，请重新发布模板')
  }

  await cloneClaudeSessionFiles({
    sourceSessionId: sourceSession.acp_session_id,
    targetSessionId: templateSession.acp_session_id,
    sourceCwd: sourceStorage.cwd,
    targetCwd: templateStorage.cwd,
    configDir: templateStorage.configDir,
  })
  log.info(
    {
      templateId: template.id,
      sourceSessionId: sourceSession.id,
      templateSessionId: templateSession.id,
      sourceCwd: sourceStorage.cwd,
      targetCwd: templateStorage.cwd,
    },
    'legacy template snapshot repaired',
  )
}

async function removeClaudeTemplateArtifacts(
  template: SessionTemplateRow,
  templateSession: SessionRow,
): Promise<void> {
  if (template.runtime !== 'claude' || !templateSession.acp_session_id) return
  const storage = resolveClaudeStorageContext(templateSession)
  await removeClaudeSessionFiles({
    sessionId: templateSession.acp_session_id,
    ...storage,
  })
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
      const snapshot = buildRuntimeStateSnapshot({
        sessionId: templateSession.id,
        projectId: projectContext.projectId,
        cwd: projectContext.cwd,
      })
      acpSessionId = await getRuntimePort().forkSession(snapshot, source.acp_session_id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await getRuntimePort().closeSession(source.agent_id, templateSession.id).catch(() => undefined)
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
    await ensureClaudeTemplateSnapshot(template, templateSession)

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
      const snapshot = buildRuntimeStateSnapshot({
        sessionId: newSession.id,
        projectId: projectContext.projectId,
        cwd: projectContext.cwd,
      })
      acpSessionId = await getRuntimePort().forkSession(snapshot, templateSession.acp_session_id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await getRuntimePort().closeSession(template.agent_id, newSession.id).catch(() => undefined)
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
        await getRuntimePort().closeSession(template.agent_id, template.template_session_id)
      } catch (err) {
        log.debug(
          { err, templateId, templateSessionId: template.template_session_id },
          'deleteTemplate: closeSession best-effort failed',
        )
      }
      await removeClaudeTemplateArtifacts(template, templateSession)
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
