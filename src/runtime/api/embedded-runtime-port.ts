import { createHash } from 'node:crypto'
import { acpHost } from '../../acp/host.js'
import type { AcpSessionContext } from '../../acp/host-types.js'
import type {
  RuntimeCancelResult,
  RuntimeElicitationContent,
  RuntimePort,
  RuntimePromptInput,
  RuntimeStateSnapshot,
} from '../../ports/runtime-port.js'
import type { ImageAttachment, SessionCapabilities } from '../../types/ws-protocol.js'
import { runtimeSessionContextFingerprint } from '../service/runtime-fingerprints.js'

interface PromptDiagnostics {
  turnId?: string
  messageId?: string
}

export interface EmbeddedRuntimeHost {
  ensureSession(
    agentId: string,
    sessionId: string,
    persistedAcpSessionId?: string | null,
    context?: AcpSessionContext,
  ): Promise<string>
  prompt(
    agentId: string,
    sessionId: string,
    content: string,
    images?: ImageAttachment[],
    diagnostics?: PromptDiagnostics,
  ): Promise<void>
  cancelPrompt(agentId: string, sessionId: string): Promise<void>
  closeSession(agentId: string, sessionId: string): Promise<void>
  forkSessionFromAcpSessionId(
    agentId: string,
    sourceAcpSessionId: string,
    targetSessionId: string,
    context?: AcpSessionContext,
  ): Promise<string>
  setModel(agentId: string, sessionId: string, modelId: string): Promise<void>
  setMode(agentId: string, sessionId: string, modeId: string): Promise<void>
  setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void>
  getSessionCapabilities(agentId: string, sessionId: string): SessionCapabilities | undefined
  resolvePermission(sessionId: string, requestId: string, optionId?: string, cancelled?: boolean): boolean
  resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: RuntimeElicitationContent,
  ): boolean
  listRunning(): string[]
  stopAgent(agentId: string): Promise<void>
}

export class EmbeddedRuntimePort implements RuntimePort {
  constructor(private readonly host: EmbeddedRuntimeHost = acpHost) {}

  ensureSession(snapshot: RuntimeStateSnapshot, options: { emitLifecycle?: boolean } = {}): Promise<string> {
    return this.host.ensureSession(
      snapshot.agent.id,
      snapshot.session.id,
      snapshot.session.acpSessionId,
      this.context(snapshot, options.emitLifecycle),
    )
  }

  prompt(input: RuntimePromptInput): Promise<void> {
    return this.host.prompt(
      input.agentId,
      input.sessionId,
      input.content,
      input.images,
      input.diagnostics ?? {},
    )
  }

  async cancelPrompt(agentId: string, sessionId: string): Promise<RuntimeCancelResult> {
    await this.host.cancelPrompt(agentId, sessionId)
    return { status: 'requested', escalation: 'cancel', messageId: `embedded-${sessionId}` }
  }

  closeSession(agentId: string, sessionId: string): Promise<void> {
    return this.host.closeSession(agentId, sessionId)
  }

  forkSession(snapshot: RuntimeStateSnapshot, sourceAcpSessionId: string): Promise<string> {
    return this.host.forkSessionFromAcpSessionId(
      snapshot.agent.id,
      sourceAcpSessionId,
      snapshot.session.id,
      this.context(snapshot),
    )
  }

  setModel(agentId: string, sessionId: string, modelId: string): Promise<void> {
    return this.host.setModel(agentId, sessionId, modelId)
  }

  setMode(agentId: string, sessionId: string, modeId: string): Promise<void> {
    return this.host.setMode(agentId, sessionId, modeId)
  }

  setConfig(agentId: string, sessionId: string, configId: string, value: string | boolean): Promise<void> {
    return this.host.setConfig(agentId, sessionId, configId, value)
  }

  async getSessionCapabilities(agentId: string, sessionId: string): Promise<SessionCapabilities | undefined> {
    return this.host.getSessionCapabilities(agentId, sessionId)
  }

  async resolvePermission(
    sessionId: string,
    requestId: string,
    optionId?: string,
    cancelled?: boolean,
  ): Promise<boolean> {
    return this.host.resolvePermission(sessionId, requestId, optionId, cancelled)
  }

  async resolveElicitation(
    sessionId: string,
    requestId: string,
    action: 'accept' | 'decline' | 'cancel',
    content?: RuntimeElicitationContent,
  ): Promise<boolean> {
    return this.host.resolveElicitation(sessionId, requestId, action, content)
  }

  async drain(): Promise<void> {}

  async close(): Promise<void> {
    for (const agentId of this.host.listRunning()) await this.host.stopAgent(agentId)
  }

  private context(snapshot: RuntimeStateSnapshot, emitLifecycle?: boolean): AcpSessionContext {
    return {
      projectId: snapshot.session.projectId ?? undefined,
      cwd: snapshot.session.cwd,
      runtimeContextKey: createHash('sha256')
        .update(runtimeSessionContextFingerprint(snapshot))
        .digest('hex'),
      ...(emitLifecycle === undefined ? {} : { emitLifecycle }),
      ...(snapshot.session.canRecreateMissingSession === undefined
        ? {}
        : { canRecreateMissingSession: snapshot.session.canRecreateMissingSession }),
    }
  }
}
