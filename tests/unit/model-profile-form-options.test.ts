import { describe, expect, test } from 'vitest'
import {
  compatibleProviders,
  providerModelIds,
} from '../../ui/src/pages/settings/model-profile-options.js'
import type { ModelProviderData } from '../../ui/src/stores/model.store.js'

describe('model profile form options', () => {
  test('filters connections by Runtime while sharing new-api connections', () => {
    const providers = [provider('openai', 'openai'), provider('claude', 'claude'), provider('new-api', 'new-api')]

    expect(compatibleProviders(providers, 'claude').map((item) => item.id)).toEqual(['claude', 'new-api'])
    expect(compatibleProviders(providers, 'codex').map((item) => item.id)).toEqual(['openai', 'new-api'])
  })

  test('reads model suggestions defensively from the selected connection', () => {
    const selected = provider('openai', 'openai')
    selected.models_json = JSON.stringify([{ id: 'gpt-5.6-sol' }, { id: ' gpt-5.5 ' }, { name: 'missing' }])

    expect(providerModelIds(selected)).toEqual(['gpt-5.6-sol', 'gpt-5.5'])
    expect(providerModelIds({ ...selected, models_json: 'invalid' })).toEqual([])
  })
})

function provider(id: string, protocol: string): ModelProviderData {
  return {
    id,
    name: id,
    display_name: id,
    protocol,
    base_url: 'https://example.com',
    api_key: '',
    models_json: '[]',
    is_default: 0,
    enabled: 1,
    created_at: '',
    updated_at: '',
  }
}
