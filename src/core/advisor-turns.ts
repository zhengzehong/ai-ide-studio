import { randomUUID } from 'node:crypto'
import { projectAdvisorStore } from '../store/advisors.js'
import { sessionStore } from '../store/sessions.js'
import type { SessionDoneData } from '../types/ws-protocol.js'
import { createAdvisorBatchScheduler } from './advisor-batch-scheduler.js'
import { ADVISOR_PROMPT_VERSION, DEFAULT_ADVISOR_PROMPT } from './advisor-prompt.js'
import { buildAdvisorPushPrompt } from './advisor-push.js'
import { finishAdvisorRoundsForSession, registerAdvisorRound } from './advisor-rounds.js'
import { createChildLogger } from './logger.js'
import { enqueueProjectInspirationTurn } from './project-inspiration-turn-queue.js'
import { sessionManager } from './sessions.js'

const log = createChildLogger('advisor-turns')
const runningAdvisorSessions = new Set<string>()
const scheduler = createAdvisorBatchScheduler(async (projectId, batch, isCurrent) => {
  await enqueueProjectInspirationTurn(projectId, async () => {
    const config = projectAdvisorStore.get(projectId)
    if (!isCurrent() || !config?.enabled || !config.session_id || !config.advisor_agent_id) return
    const advisorSession = sessionStore.get(config.session_id)
    if (!advisorSession || advisorSession.deleted_at || advisorSession.archived_at || advisorSession.status !== 'active') return
    const valid = batch.filter((ev) => {
      const session = sessionStore.get(ev.sessionId)
      return session?.project_id === projectId && !session.deleted_at && !session.archived_at
        && session.id !== config.session_id && session.purpose === 'conversation'
    })
    if (!valid.length) return
    const roundId = `advisor-batch-${randomUUID()}`
    const { prompt, triggerSessionId } = buildAdvisorPushPrompt(
      projectId, valid, config.advisor_prompt || DEFAULT_ADVISOR_PROMPT, roundId,
    )
    registerAdvisorRound(roundId, { projectId, advisorSessionId: config.session_id, triggerSessionId })
    runningAdvisorSessions.add(config.session_id)
    log.info({ projectId, roundId, sessionCount: valid.length, promptVersion: ADVISOR_PROMPT_VERSION }, '参谋聚合分析开始')
    try {
      await sessionManager.enqueuePrompt(config.session_id, prompt, undefined, {
        contextProjectId: projectId, senderRole: 'advisor', senderName: 'AI 参谋',
        batchKey: `advisor-round:${roundId}`, dedupeKey: `advisor:${roundId}`,
      })
      if (isCurrent()) projectAdvisorStore.update(projectId, { lastError: null })
    } catch (err) {
      if (isCurrent()) projectAdvisorStore.update(projectId, { lastError: err instanceof Error ? err.message : String(err) })
      throw err
    } finally {
      runningAdvisorSessions.delete(config.session_id)
      log.info({ projectId, roundId }, '参谋聚合分析结束')
    }
  })
})

export function handleSessionTurnDone(ev: SessionDoneData): void {
  try {
    if (ev.stopReason !== 'end_turn' || runningAdvisorSessions.has(ev.sessionId)) return
    const session = sessionStore.get(ev.sessionId)
    if (!session?.project_id || session.purpose !== 'conversation' || session.deleted_at || session.archived_at) return
    const config = projectAdvisorStore.get(session.project_id)
    if (!config?.enabled || !config.session_id || !config.advisor_agent_id) return
    if (ev.sessionId === config.session_id) {
      finishAdvisorRoundsForSession(ev.sessionId)
      return
    }
    scheduler.add(session.project_id, ev)
  } catch (err) {
    log.warn({ err, sessionId: ev.sessionId }, '参谋变化收集失败')
  }
}

export function resetAdvisorScheduling(projectId: string): void {
  scheduler.reset(projectId)
}

export function disposeAdvisorScheduling(): void {
  scheduler.dispose()
}
