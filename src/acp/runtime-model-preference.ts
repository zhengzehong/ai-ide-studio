import type { SessionCapabilities } from '../types/ws-protocol.js'
import type { AppliedModelProfile } from './model-profile-env.js'

export function modelProfileChanged(previous?: AppliedModelProfile, next?: AppliedModelProfile): boolean {
  return previous?.id !== next?.id
    || previous?.modelId !== next?.modelId
    || previous?.effort !== next?.effort
    || previous?.contextWindow !== next?.contextWindow
}

export function resolveRuntimeModelPreference(input: {
  runtime: string
  profile?: AppliedModelProfile
  capabilities: SessionCapabilities
  sessionModelId?: string
}): string | undefined {
  if (input.sessionModelId) return input.sessionModelId
  if (input.runtime !== 'codex' || !input.profile?.modelId) return undefined

  const modelId = input.profile.modelId.trim()
  if (!modelId) return undefined
  const available = new Set(input.capabilities.models?.map((model) => model.modelId) ?? [])
  const currentEffort = parseCodexEffort(input.capabilities.currentModelId)
  const desiredEffort = input.profile.effort?.trim() || currentEffort
  const qualified = desiredEffort ? `${stripCodexEffort(modelId)}[${desiredEffort}]` : modelId

  // ACP 1.10 exposes model and reasoning_effort independently; older adapters expose qualified model IDs.
  if (available.has(modelId)) return modelId

  if (available.size === 0 || available.has(qualified)) return qualified
  if (
    input.capabilities.currentModelId
    && stripCodexEffort(input.capabilities.currentModelId) === stripCodexEffort(modelId)
  ) return input.capabilities.currentModelId
  return [...available].find((candidate) => stripCodexEffort(candidate) === stripCodexEffort(modelId))
}

function parseCodexEffort(modelId: string | undefined): string | undefined {
  return modelId?.match(/\[([^\]]+)]$/)?.[1]
}

function stripCodexEffort(modelId: string): string {
  return modelId.replace(/\[[^\]]+]$/, '')
}
