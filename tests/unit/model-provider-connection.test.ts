import { describe, expect, test } from 'vitest'
import {
  buildProviderModelsUrl,
  isProviderProtocolCompatible,
} from '../../src/shared/model-provider-connection.js'

describe('model provider connections', () => {
  test('does not duplicate an existing v1 path when listing models', () => {
    expect(buildProviderModelsUrl('https://gateway.example.com/v1')).toBe('https://gateway.example.com/v1/models')
    expect(buildProviderModelsUrl('https://gateway.example.com/v1/')).toBe('https://gateway.example.com/v1/models')
    expect(buildProviderModelsUrl('https://gateway.example.com')).toBe('https://gateway.example.com/v1/models')
  })

  test('matches provider protocols to the selected Runtime', () => {
    expect(isProviderProtocolCompatible('claude', 'claude')).toBe(true)
    expect(isProviderProtocolCompatible('claude', 'new-api')).toBe(true)
    expect(isProviderProtocolCompatible('claude', 'openai')).toBe(false)
    expect(isProviderProtocolCompatible('codex', 'openai')).toBe(true)
    expect(isProviderProtocolCompatible('codex', 'new-api')).toBe(true)
    expect(isProviderProtocolCompatible('codex', 'claude')).toBe(false)
  })
})
