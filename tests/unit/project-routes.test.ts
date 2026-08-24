import { beforeEach, describe, expect, test } from 'vitest'
import {
  buildProjectPath,
  normalizeProjectLocation,
  readLastProjectLocation,
  rememberProjectLocation,
  removeProjectLocation,
  stripProjectPrefix,
} from '../../ui/src/routing/project-routes.ts'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('project route memory', () => {
  let storage: Storage

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  test('restores pathname, search and hash for each project', () => {
    rememberProjectLocation('project-a', {
      pathname: '/tasks',
      search: '?status=running',
      hash: '#today',
    }, storage)

    const remembered = readLastProjectLocation('project-a', storage)
    expect(remembered).toEqual({
      pathname: '/tasks',
      search: '?status=running',
      hash: '#today',
    })
    expect(buildProjectPath('project-a', remembered))
      .toBe('/p/project-a/tasks?status=running#today')
  })

  test('rejects global and malformed remembered paths', () => {
    expect(normalizeProjectLocation({ pathname: '/settings', search: '?x=1', hash: '#bad' }))
      .toEqual({ pathname: '/workspace', search: '', hash: '' })

    storage.setItem('ai-ide-project-last-locations-v1', '{bad json')
    expect(readLastProjectLocation('project-a', storage))
      .toEqual({ pathname: '/workspace', search: '', hash: '' })
  })

  test('strips the encoded project prefix and preserves nested project paths', () => {
    expect(stripProjectPrefix('/p/project-a/tasks/modes', 'project-a')).toBe('/tasks/modes')
    expect(buildProjectPath('project/a', { pathname: '/knowledge', search: '', hash: '' }))
      .toBe('/p/project%2Fa/knowledge')
  })

  test('keeps the project secretary route instead of falling back to workspace', () => {
    expect(normalizeProjectLocation({ pathname: '/secretary', search: '', hash: '' }))
      .toEqual({ pathname: '/secretary', search: '', hash: '' })
    expect(buildProjectPath('project-a', { pathname: '/secretary', search: '', hash: '' }))
      .toBe('/p/project-a/secretary')
  })

  test('keeps the project inspiration route instead of falling back to workspace', () => {
    expect(normalizeProjectLocation({ pathname: '/inspiration', search: '', hash: '' }))
      .toEqual({ pathname: '/inspiration', search: '', hash: '' })
    expect(buildProjectPath('project-a', { pathname: '/inspiration', search: '', hash: '' }))
      .toBe('/p/project-a/inspiration')
  })

  test('removes only the target project memory', () => {
    rememberProjectLocation('project-a', { pathname: '/tasks', search: '', hash: '' }, storage)
    rememberProjectLocation('project-b', { pathname: '/events', search: '', hash: '' }, storage)

    removeProjectLocation('project-a', storage)

    expect(readLastProjectLocation('project-a', storage).pathname).toBe('/workspace')
    expect(readLastProjectLocation('project-b', storage).pathname).toBe('/events')
  })
})
