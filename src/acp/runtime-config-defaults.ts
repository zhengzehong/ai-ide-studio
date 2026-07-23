import type { ConfigOptionInfo } from '../types/ws-protocol.js'

const DEFAULT_EFFORT_ID = 'effort'
const MAX_EFFORT = 'max'

export function configPreferencesWithDefaults(
  configOptions: ConfigOptionInfo[] | undefined,
  preferences: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> | undefined {
  if (Object.prototype.hasOwnProperty.call(preferences ?? {}, DEFAULT_EFFORT_ID)) return preferences
  const effort = configOptions?.find((option) => option.id === DEFAULT_EFFORT_ID)
  if (!effort?.options?.some((option) => option.value === MAX_EFFORT)) return preferences
  return { ...preferences, [DEFAULT_EFFORT_ID]: MAX_EFFORT }
}
