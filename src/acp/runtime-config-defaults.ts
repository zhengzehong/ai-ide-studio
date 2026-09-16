import type { ConfigOptionInfo } from '../types/ws-protocol.js'
import { EFFORT_CONFIG_IDS } from '../shared/effort-config.js'

/** @deprecated 统一匹配表见 src/shared/effort-config.ts（服务端与 UI 共用）；保留导出兼容既有引用。 */
export const DEFAULT_EFFORT_IDS = EFFORT_CONFIG_IDS
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
