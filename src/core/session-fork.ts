import { sessionStore } from '../store/sessions.js'
import { getRuntimePort } from '../runtime/runtime-port-provider.js'
import { buildRuntimeStateSnapshot } from '../runtime/api/runtime-snapshot.js'
import { createChildLogger } from './logger.js'

const log = createChildLogger('session-fork')

export interface ForkSessionIntoInput {
  /** 源会话（须已有 acp_session_id，否则抛「暂无可复制的运行时上下文」）。 */
  sourceSessionId: string
  /** 目标本地会话行（调用方先建好；本函数只做 ACP 层 fork + acp_session_id 回写）。 */
  targetSessionId: string
  projectContext?: { projectId?: string; cwd?: string }
}

/**
 * 把源会话的运行时上下文 fork 进一个已存在的本地会话行。
 * 普通会话复制（copySession）与团队会话线复制（copyTeamConversation）共用同一核心；
 * 失败清理、stage、事件反馈由调用方各自负责（两者的失败语义不同：单会话删行，团队线整线回滚）。
 */
export async function forkSessionInto(input: ForkSessionIntoInput): Promise<string> {
  const source = sessionStore.get(input.sourceSessionId)
  if (!source) throw new Error(`Session not found: ${input.sourceSessionId}`)
  const sourceAcpSessionId = source.acp_session_id
  if (!sourceAcpSessionId) throw new Error('当前会话暂无可复制的运行时上下文')

  const snapshot = buildRuntimeStateSnapshot({
    sessionId: input.targetSessionId,
    projectId: input.projectContext?.projectId,
    cwd: input.projectContext?.cwd,
  })
  const acpSessionId = await getRuntimePort().forkSession(snapshot, sourceAcpSessionId)
  sessionStore.updateAcpSessionId(input.targetSessionId, acpSessionId)
  log.info(
    { sourceSessionId: input.sourceSessionId, targetSessionId: input.targetSessionId, acpSessionId },
    'Session runtime context forked into target',
  )
  return acpSessionId
}
