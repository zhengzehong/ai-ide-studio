import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  readLastAgent,
  writeLastAgent,
  formatTime,
} from '../../mobile/src/components/chat/NewSessionSheet.utils'

describe('NewSessionSheet.utils', () => {
  describe('readLastAgent / writeLastAgent', () => {
    let store: Record<string, string>

    beforeEach(() => {
      store = {}
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => { store[key] = value },
        removeItem: (key: string) => { delete store[key] },
        clear: () => { store = {} },
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('writeLastAgent writes to mobile:lastAgentByProject:{projectId}', () => {
      writeLastAgent('proj-1', 'agent-A')
      expect(globalThis.localStorage.getItem('mobile:lastAgentByProject:proj-1')).toBe('agent-A')
    })

    it('readLastAgent returns null when nothing stored', () => {
      expect(readLastAgent('proj-1')).toBeNull()
    })

    it('readLastAgent returns last written value', () => {
      writeLastAgent('proj-1', 'agent-B')
      expect(readLastAgent('proj-1')).toBe('agent-B')
    })

    it('readLastAgent returns null for different project', () => {
      writeLastAgent('proj-1', 'agent-A')
      expect(readLastAgent('proj-2')).toBeNull()
    })

    it('writeLastAgent overwrites previous value', () => {
      writeLastAgent('proj-1', 'agent-A')
      writeLastAgent('proj-1', 'agent-B')
      expect(readLastAgent('proj-1')).toBe('agent-B')
    })
  })

  describe('formatTime relative formats', () => {
    it('returns 刚刚 for < 1 minute', () => {
      const now = new Date().toISOString()
      expect(formatTime(now)).toBe('刚刚')
    })

    it('returns X 分钟前 for < 1 hour', () => {
      const d = new Date(Date.now() - 5 * 60_000).toISOString()
      expect(formatTime(d)).toBe('5 分钟前')
    })

    it('returns X 小时前 for < 1 day', () => {
      const d = new Date(Date.now() - 3 * 3_600_000).toISOString()
      expect(formatTime(d)).toBe('3 小时前')
    })

    it('returns X 天前 for < 1 week', () => {
      const d = new Date(Date.now() - 2 * 86_400_000).toISOString()
      expect(formatTime(d)).toBe('2 天前')
    })

    it('returns M/D for >= 1 week', () => {
      const d = new Date(Date.now() - 10 * 86_400_000).toISOString()
      const result = formatTime(d)
      expect(result).toMatch(/^\d+\/\d+$/)
    })
  })
})

