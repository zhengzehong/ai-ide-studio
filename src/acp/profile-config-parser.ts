import type { ClaudeModelProfileConfig, CodexModelProfileConfig } from '../store/model-profiles.js'

export function parseClaudeConfig(raw: string): ClaudeModelProfileConfig {
  const config = parseRecord(raw)
  const defaultModel = typeof config.defaultModel === 'string' ? config.defaultModel.trim() : ''
  return {
    defaultModel,
    haikuModel: typeof config.haikuModel === 'string' ? config.haikuModel : undefined,
    sonnetModel: typeof config.sonnetModel === 'string' ? config.sonnetModel : undefined,
    opusModel: typeof config.opusModel === 'string' ? config.opusModel : undefined,
    allowImageRead: config.allowImageRead === true,
  }
}

export function parseCodexConfig(raw: string): CodexModelProfileConfig {
  const config = parseRecord(raw)
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  const effort = typeof config.effort === 'string' ? config.effort.trim() : ''
  return { model, ...(effort ? { effort } : {}) }
}

function parseRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
