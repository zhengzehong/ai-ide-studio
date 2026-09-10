import { describe, expect, it, vi } from 'vitest'
import { TeamViewCache, shareTeamRequest, invalidateTeamRequest, teamCacheKey } from '../../ui/src/components/team/team-view-cache'

describe('team view cache', () => {
  it('keeps recent conversations and isolates project/team keys', () => {
    const cache = new TeamViewCache<string>(2)
    const a = teamCacheKey('p1', 't', 'c')
    const b = teamCacheKey('p2', 't', 'c')
    cache.set(a, 'a'); cache.set(b, 'b')
    expect(cache.get(a)).toBe('a')
    cache.set('third', 'c')
    expect(cache.get(b)).toBeUndefined()
    expect(cache.get(a)).toBe('a')
    cache.delete(a)
    expect(cache.get(a)).toBeUndefined()
  })

  it('deduplicates overlapping reads and permits retry after failure', async () => {
    const request = vi.fn(async () => { throw new Error('offline') })
    const first = shareTeamRequest('retry-test', request)
    expect(shareTeamRequest('retry-test', request)).toBe(first)
    await expect(first).rejects.toThrow('offline')
    await expect(shareTeamRequest('retry-test', async () => 'recovered')).resolves.toBe('recovered')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not reuse a pre-mutation request or let its cleanup remove the fresh request', async () => {
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const old = shareTeamRequest('mutate-test', () => new Promise<string>(resolve => { resolveOld = resolve }))
    invalidateTeamRequest('mutate-test')
    const fresh = shareTeamRequest('mutate-test', () => new Promise<string>(resolve => { resolveNew = resolve }))
    resolveOld('old'); await old
    expect(shareTeamRequest('mutate-test', async () => 'wrong')).toBe(fresh)
    resolveNew('new'); await expect(fresh).resolves.toBe('new')
  })
})
