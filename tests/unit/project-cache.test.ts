import { describe, expect, test } from 'vitest'
import {
  ALL_PROJECTS_SCOPE,
  beginProjectRequest,
  canCommitProjectResponse,
  commitProjectResponse,
  emptyProjectCache,
  invalidateProjectCache,
  patchCachedArrays,
  projectScopeKey,
  pruneProjectCache,
  readProjectCache,
  removeCachedArrayItem,
  shouldRefreshProjectCache,
} from '../../ui/src/stores/project-cache.ts'

interface Row {
  id: string
  value: string
}

describe('project cache state machine', () => {
  test('tracks request sequence independently for each scope', () => {
    let state = emptyProjectCache<string[]>()
    const a1 = beginProjectRequest(state, 'a')
    state = a1.state
    const b1 = beginProjectRequest(state, 'b')
    state = b1.state
    const a2 = beginProjectRequest(state, 'a')
    state = a2.state

    expect(canCommitProjectResponse(state, 'a', a1.requestSeq)).toBe(false)
    expect(canCommitProjectResponse(state, 'a', a2.requestSeq)).toBe(true)
    expect(canCommitProjectResponse(state, 'b', b1.requestSeq)).toBe(true)
  })

  test('commits only the latest response and marks fresh cached data', () => {
    let state = emptyProjectCache<string[]>()
    const request = beginProjectRequest(state, 'a')
    state = commitProjectResponse(request.state, {
      scope: 'a',
      requestSeq: request.requestSeq,
      data: ['a'],
      now: 1_000,
    })

    expect(readProjectCache(state, 'a')?.data).toEqual(['a'])
    expect(shouldRefreshProjectCache(readProjectCache(state, 'a'), 30_999)).toBe(false)
    expect(shouldRefreshProjectCache(readProjectCache(state, 'a'), 31_001)).toBe(true)

    state = invalidateProjectCache(state, 'a')
    expect(shouldRefreshProjectCache(readProjectCache(state, 'a'), 1_001)).toBe(true)
  })

  test('patches and removes matching rows across every cached scope', () => {
    let state = emptyProjectCache<Row[]>()
    for (const [scope, data] of [
      ['a', [{ id: '1', value: 'a' }]],
      ['b', [{ id: '2', value: 'b' }]],
      [ALL_PROJECTS_SCOPE, [{ id: '1', value: 'a' }, { id: '2', value: 'b' }]],
    ] as const) {
      const request = beginProjectRequest(state, scope)
      state = commitProjectResponse(request.state, {
        scope,
        requestSeq: request.requestSeq,
        data: [...data],
        now: 100,
      })
    }

    state = patchCachedArrays(state, '2', { value: 'updated' })
    expect(readProjectCache(state, 'a')?.data).toEqual([{ id: '1', value: 'a' }])
    expect(readProjectCache(state, 'b')?.data).toEqual([{ id: '2', value: 'updated' }])
    expect(readProjectCache(state, ALL_PROJECTS_SCOPE)?.data[1]?.value).toBe('updated')

    state = removeCachedArrayItem(state, '1')
    expect(readProjectCache(state, 'a')?.data).toEqual([])
    expect(readProjectCache(state, ALL_PROJECTS_SCOPE)?.data).toEqual([{ id: '2', value: 'updated' }])
  })

  test('prunes least recently used projects while retaining active and global scopes', () => {
    let state = emptyProjectCache<string[]>()
    for (const [index, scope] of ['a', 'b', 'c', 'd', 'e', 'f', ALL_PROJECTS_SCOPE].entries()) {
      const request = beginProjectRequest(state, scope)
      state = commitProjectResponse(request.state, {
        scope,
        requestSeq: request.requestSeq,
        data: [scope],
        now: index + 1,
      })
    }

    state = pruneProjectCache(state, 'a', 5)

    expect(readProjectCache(state, 'a')).not.toBeNull()
    expect(readProjectCache(state, 'b')).toBeNull()
    expect(readProjectCache(state, ALL_PROJECTS_SCOPE)).not.toBeNull()
    expect(Object.keys(state.entries)).toHaveLength(6)
  })

  test('uses a dedicated scope for unfiltered global lists', () => {
    expect(projectScopeKey()).toBe(ALL_PROJECTS_SCOPE)
    expect(projectScopeKey(null)).toBe(ALL_PROJECTS_SCOPE)
    expect(projectScopeKey('project-a')).toBe('project-a')
  })
})
