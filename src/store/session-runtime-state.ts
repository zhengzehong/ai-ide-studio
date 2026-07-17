export type SessionRuntimeState = 'running' | 'idle'

export const RUNNING_SESSION_STAGES: readonly string[] = [
  '\u6b63\u5728\u51c6\u5907 Agent...',
  '\u6b63\u5728\u542f\u52a8 Agent...',
  'Agent \u5df2\u5c31\u7eea',
  '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...',
  '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...',
  '\u4f1a\u8bdd\u5df2\u8fde\u63a5',
  '\u6b63\u5728\u601d\u8003...',
]

export interface SessionRuntimeSignals {
  promptActive: boolean
  hasRunningAgentMessage: boolean
  hasRunningProcessItem: boolean
  status: string
  stage: string | null
}

export function resolveSessionRuntimeState(signals: SessionRuntimeSignals): SessionRuntimeState {
  if (signals.promptActive) return 'running'
  if (signals.hasRunningAgentMessage) return 'running'
  if (signals.hasRunningProcessItem) return 'running'
  if (signals.status !== 'active') return 'idle'
  return signals.stage && RUNNING_SESSION_STAGES.includes(signals.stage) ? 'running' : 'idle'
}
