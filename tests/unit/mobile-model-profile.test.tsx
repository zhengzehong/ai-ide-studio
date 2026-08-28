import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import {
  filterEnabledProfiles,
  parseAgentProfile,
  profileModelLabel,
} from '../../mobile/src/utils/model-profile'
import { ProfileRow } from '../../mobile/src/components/settings/ModelProfileSheets'

describe('mobile model profile', () => {
  test('parseAgentProfile mirrors the PC modal rules', () => {
    expect(parseAgentProfile(null)).toEqual({ mode: 'global', profileId: null })
    expect(parseAgentProfile(undefined)).toEqual({ mode: 'global', profileId: null })
    expect(parseAgentProfile('not-json')).toEqual({ mode: 'global', profileId: null })
    // 显式 mode 优先
    expect(parseAgentProfile(JSON.stringify({ modelProfileMode: 'global', modelProfileId: 'p1' })))
      .toEqual({ mode: 'global', profileId: 'p1' })
    expect(parseAgentProfile(JSON.stringify({ modelProfileMode: 'system' })))
      .toEqual({ mode: 'system', profileId: null })
    expect(parseAgentProfile(JSON.stringify({ modelProfileMode: 'fixed', modelProfileId: 'p2' })))
      .toEqual({ mode: 'fixed', profileId: 'p2' })
    // 没有 mode 但有 profileId → fixed
    expect(parseAgentProfile(JSON.stringify({ modelProfileId: 'p3' })))
      .toEqual({ mode: 'fixed', profileId: 'p3' })
    // 只有 mode 没有 id 的 fixed,原样保留(PC 端同样会出现)
    expect(parseAgentProfile(JSON.stringify({ modelProfileMode: 'fixed' })))
      .toEqual({ mode: 'fixed', profileId: null })
  })

  test('filterEnabledProfiles keeps only enabled profiles of the runtime', () => {
    const profiles = [
      { id: 'a', name: 'A', runtime: 'claude', enabled: 1 },
      { id: 'b', name: 'B', runtime: 'claude', enabled: 0 },
      { id: 'c', name: 'C', runtime: 'codex', enabled: 1 },
      { id: 'd', name: 'D', runtime: 'claude', enabled: true },
    ]
    expect(filterEnabledProfiles(profiles as never, 'claude').map((p) => p.id)).toEqual(['a', 'd'])
    expect(filterEnabledProfiles(profiles as never, 'codex').map((p) => p.id)).toEqual(['c'])
  })

  test('profileModelLabel reads the primary model name from profile config', () => {
    expect(profileModelLabel(null)).toBe('')
    expect(profileModelLabel('bad json')).toBe('')
    expect(profileModelLabel(JSON.stringify({ defaultModel: 'claude-sonnet-5' }))).toBe('claude-sonnet-5')
    expect(profileModelLabel(JSON.stringify({ model: 'gpt-5.2', effort: 'high' }))).toBe('gpt-5.2')
  })

  test('ProfileRow renders label and selection state', () => {
    const html = renderToStaticMarkup(
      <ProfileRow label="GLM 高智" sub="glm-5.3-flash" selected disabled={false} onClick={() => {}} />,
    )
    expect(html).toContain('GLM 高智')
    expect(html).toContain('glm-5.3-flash')
    expect(html).toContain('aria-pressed="true"')
    const unselected = renderToStaticMarkup(
      <ProfileRow label="默认" selected={false} onClick={() => {}} />,
    )
    expect(unselected).toContain('aria-pressed="false"')
  })

  test('wires the agreed entries: session-group header long press and settings entry', () => {
    const group = readFileSync(resolve('mobile/src/components/SessionGroup.tsx'), 'utf8')
    expect(group).toContain('onHeaderLongPress')

    const listPage = readFileSync(resolve('mobile/src/pages/SessionListPage.tsx'), 'utf8')
    expect(listPage).toContain('onHeaderLongPress={() => handleHeaderLongPress(group.agentId)}')
    expect(listPage).toContain('AgentProfileSheet')

    const settings = readFileSync(resolve('mobile/src/pages/SettingsPage.tsx'), 'utf8')
    expect(settings).toContain('全局模型档案')
    expect(settings).toContain('GlobalProfileSheet')
  })
})
