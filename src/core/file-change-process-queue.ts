import type { FileChangeDetailData, ToolCallData } from '../types/ws-protocol.js'

export interface FileChangeProcessInput {
  sessionId: string
  messageId: string
  agentId: string
  toolCall: ToolCallData
  onResult: (detail: FileChangeDetailData, toolCall: ToolCallData) => void
}

export interface FileChangeProcessQueueOptions {
  calculate: (toolCall: ToolCallData) => Promise<FileChangeDetailData>
  onError?: (error: unknown, input: FileChangeProcessInput) => void
}

interface FileChangeProcessState {
  latest: FileChangeProcessInput
  version: number
  settledVersion: number
  cancelled: boolean
  running?: Promise<void>
}

export class FileChangeProcessQueue {
  private readonly states = new Map<string, FileChangeProcessState>()

  constructor(private readonly options: FileChangeProcessQueueOptions) {}

  update(input: FileChangeProcessInput): void {
    if (!hasDiff(input.toolCall)) return
    const key = processKey(input)
    const existing = this.states.get(key)
    if (existing && sameDiffPayload(existing.latest.toolCall, input.toolCall)) {
      existing.latest = {
        ...input,
        agentId: input.agentId || existing.latest.agentId,
      }
      if (isTerminal(input.toolCall.status)) void this.run(existing)
      return
    }
    const state = existing ?? { latest: input, version: 0, settledVersion: 0, cancelled: false }
    state.latest = input
    state.version += 1
    this.states.set(key, state)
    if (isTerminal(input.toolCall.status)) void this.run(state)
  }

  async drain(sessionId: string): Promise<void> {
    while (true) {
      const states = [...this.states.values()].filter((state) => state.latest.sessionId === sessionId)
      if (states.length === 0) return
      for (const state of states) {
        if (state.settledVersion < state.version && !state.running) void this.run(state)
      }
      await Promise.all(states.map((state) => state.running).filter((value): value is Promise<void> => !!value))
      if (states.every((state) => state.settledVersion >= state.version && !state.running)) return
    }
  }

  finish(sessionId: string): void {
    for (const [key, state] of this.states) {
      if (state.latest.sessionId === sessionId) this.states.delete(key)
    }
  }

  reset(): void {
    for (const state of this.states.values()) state.cancelled = true
    this.states.clear()
  }

  private run(state: FileChangeProcessState): Promise<void> {
    if (state.running) return state.running
    const input = state.latest
    const version = state.version
    const running = this.options.calculate(input.toolCall).then(
      (detail) => {
        if (!state.cancelled && state.version === version) state.latest.onResult(detail, state.latest.toolCall)
      },
      (error) => {
        try {
          this.options.onError?.(error, state.latest)
        } catch {
          // Error reporting must not turn an isolated diff failure into a turn failure.
        }
      },
    ).finally(() => {
      state.settledVersion = Math.max(state.settledVersion, version)
      state.running = undefined
      if (!state.cancelled && state.version > state.settledVersion && isTerminal(state.latest.toolCall.status)) {
        void this.run(state)
      }
    })
    state.running = running
    return running
  }
}

function processKey(input: FileChangeProcessInput): string {
  return `${input.sessionId}:${input.messageId}:${input.toolCall.id}`
}

function hasDiff(toolCall: ToolCallData): boolean {
  return toolCall.content?.some((item) => item.type === 'diff' && typeof item.newText === 'string') === true
}

function sameDiffPayload(current: ToolCallData, next: ToolCallData): boolean {
  return current === next || current.content === next.content
}

function isTerminal(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled'
}
