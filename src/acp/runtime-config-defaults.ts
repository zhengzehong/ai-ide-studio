import type { ConfigOptionInfo } from '../types/ws-protocol.js'

export const DEFAULT_EFFORT_IDS = ['reasoning_effort', 'effort'] as const
const MAX_EFFORT = 'max'

export function findEffortConfigId(configOptions: ConfigOptionInfo[] | undefined): string | undefined {
  return DEFAULT_EFFORT_IDS.find((id) => configOptions?.some((option) => option.id === id))
}

export function configPreferencesWithDefaults(
  configOptions: ConfigOptionInfo[] | undefined,
  preferences: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> | undefined {
  const effortId = findEffortConfigId(configOptions)
  if (!effortId || Object.prototype.hasOwnProperty.call(preferences ?? {}, effortId)) return preferences
  const effort = configOptions?.find((option) => option.id === effortId)
  if (!effort?.options?.some((option) => option.value === MAX_EFFORT)) return preferences
  return { ...preferences, [effortId]: MAX_EFFORT }
}
