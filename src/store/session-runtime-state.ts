export type SessionRuntimeState = 'running' | 'idle'

/**
 * \u6392\u961f\u4e2d(\u524d\u9762\u6709\u672a\u5b8c\u6210\u56de\u5408)\u2014\u2014\u961f\u5217\u53ef\u89c1\u6027\u7528\u7684 stage \u6587\u672c\u3002
 * \u4e0e ui/src/utils/session-indicators.ts \u7684 RUNNING_STAGE_TEXTS \u4fdd\u6301\u4e00\u81f4\u3002
 */
export const QUEUED_PROMPT_STAGE = '\u6392\u961f\u4e2d(\u524d\u9762\u6709\u672a\u5b8c\u6210\u56de\u5408)'

export const RUNNING_SESSION_STAGES: readonly string[] = [
  '\u6b63\u5728\u51c6\u5907 Agent...',
  '\u6b63\u5728\u542f\u52a8 Agent...',
  'Agent \u5df2\u5c31\u7eea',
  '\u6b63\u5728\u6062\u590d\u4f1a\u8bdd...',
  '\u6b63\u5728\u8fde\u63a5\u4f1a\u8bdd...',
  '\u4f1a\u8bdd\u5df2\u8fde\u63a5',
  '\u6b63\u5728\u601d\u8003...',
  QUEUED_PROMPT_STAGE,
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
