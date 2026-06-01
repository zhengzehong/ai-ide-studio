import { events } from './events.js'
import { createChildLogger } from './logger.js'
import { sessionManager } from './sessions.js'

const log = createChildLogger('team-member-dispatch')

export type DispatchMemberPromptStatus = 'accepted' | 'queued'

export interface DispatchMemberPromptInput {
  teamId: string
  memberId: string
  sessionId: string
  prompt: string
}

const activeMemberSessions = new Set<string>()
const pendingByMemberSession = new Map<string, DispatchMemberPromptInput>()

events.on('session:done', (ev) => {
  activeMemberSessions.delete(ev.sessionId)
  const pending = pendingByMemberSession.get(ev.sessionId)
  if (!pending) return
  pendingByMemberSession.delete(ev.sessionId)
  dispatchMemberPrompt(pending)
})

export function dispatchMemberPrompt(input: DispatchMemberPromptInput): DispatchMemberPromptStatus {
  if (sessionManager.isPromptActive(input.sessionId) || activeMemberSessions.has(input.sessionId)) {
    pendingByMemberSession.set(input.sessionId, input)
    log.debug(
      { teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId },
      'Team member prompt queued',
    )
    return 'queued'
  }

  activeMemberSessions.add(input.sessionId)
  void sessionManager
    .enqueuePrompt(input.sessionId, input.prompt)
    .then(() => {
      activeMemberSessions.delete(input.sessionId)
    })
    .catch((err: unknown) => {
      if (isActivePromptError(err)) {
        pendingByMemberSession.set(input.sessionId, input)
        log.debug(
          { teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId },
          'Team member prompt queued',
        )
        return
      }
      activeMemberSessions.delete(input.sessionId)
      log.error(
        { err, teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId },
        'Team member prompt failed',
      )
    })
  return 'accepted'
}

function isActivePromptError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('当前会话正在生成中')
}
