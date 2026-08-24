export type PromptIntentSource = 'task-step' | 'user' | 'platform'

export interface PromptIntent {
  source: PromptIntentSource
  dedupeKey?: string
  taskId?: string
  stepId?: string
  sessionId?: string
}

export interface PromptIntentValidation {
  valid: boolean
  reason?: string
}

export interface PromptIntentValidator {
  validate(intent: PromptIntent): PromptIntentValidation | Promise<PromptIntentValidation>
}
