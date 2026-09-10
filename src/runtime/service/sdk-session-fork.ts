import type * as acp from '@agentclientprotocol/sdk'
import type { cloneClaudeSessionFiles, hasClaudeSessionFiles } from '../../acp/claude-session-files.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'
import { createChildLogger } from '../../shared/logger.js'
import type { SessionCapabilities } from '../../types/ws-protocol.js'
import { initialCapabilities, openSdkSession } from './sdk-session-runtime.js'

const log = createChildLogger('sdk-session-fork')

export async function prepareSdkSessionFork(input: {
  connection: acp.ClientSideConnection
  agentCapabilities?: acp.AgentCapabilities
  snapshot: RuntimeStateSnapshot
  sourceAcpSessionId: string
  materializeClaudeSession: typeof cloneClaudeSessionFiles
  findClaudeSessionFiles: typeof hasClaudeSessionFiles
}): Promise<{ acpSessionId: string; capabilities: SessionCapabilities }> {
  const { connection, snapshot, sourceAcpSessionId, agentCapabilities } = input
  if (!agentCapabilities?.sessionCapabilities?.fork) throw new Error(`Agent ${snapshot.agent.id} does not support fork`)
  if (snapshot.agent.runtime === 'claude' && !await input.findClaudeSessionFiles({
    sessionId: sourceAcpSessionId,
    cwd: snapshot.session.cwd,
    configDir: snapshot.runtime.env.CLAUDE_CONFIG_DIR,
  })) {
    throw new Error(`Claude Session snapshot is missing: ${sourceAcpSessionId}`)
  }
  const result = await connection.unstable_forkSession({
    sessionId: sourceAcpSessionId,
    cwd: snapshot.session.cwd,
    mcpServers: snapshot.mcpServers,
    _meta: snapshot.runtime.sessionMeta,
  })
  const context = { agentId: snapshot.agent.id, sessionId: snapshot.session.id, sourceAcpSessionId, targetAcpSessionId: result.sessionId }
  try {
    if (snapshot.agent.runtime === 'claude') {
      await input.materializeClaudeSession({
        sourceSessionId: sourceAcpSessionId,
        targetSessionId: result.sessionId,
        sourceCwd: snapshot.session.cwd,
        targetCwd: snapshot.session.cwd,
        configDir: snapshot.runtime.env.CLAUDE_CONFIG_DIR,
      })
    }
    if (snapshot.agent.runtime === 'codex') {
      // Codex ACP unsubscribes a fork; resume it before treating it as prompt-ready.
      log.debug(context, 'Restoring Codex fork event subscription')
      const opened = await openSdkSession({
        connection,
        agentCapabilities,
        snapshot: {
          ...snapshot,
          session: { ...snapshot.session, canRecreateMissingSession: false },
        },
        acpSessionIdToResume: result.sessionId,
      })
      log.info(context, 'Codex fork event subscription restored')
      return opened
    }
    return { acpSessionId: result.sessionId, capabilities: initialCapabilities(result, agentCapabilities) }
  } catch (error) {
    log.error({ ...context, err: error }, 'Failed to prepare forked Session')
    await connection.closeSession({ sessionId: result.sessionId }).catch((closeError: unknown) => {
      log.warn({ ...context, err: closeError }, 'Failed to close unready forked Session')
    })
    throw error
  }
}
