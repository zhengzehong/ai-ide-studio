import { describe, expect, test } from 'vitest'
import {
  resolveWorkspaceLoadState,
  shouldShowWorkspaceMessageSync,
} from '../../ui/src/pages/workspace/load-state.ts'

describe('workspace load state', () => {
  test('does not present an initial request as empty', () => {
    expect(resolveWorkspaceLoadState({ loading: true, error: null, itemCount: 0 })).toBe('loading')
  })

  test('presents a cold failure as retryable instead of empty', () => {
    expect(resolveWorkspaceLoadState({ loading: false, error: '加载失败', itemCount: 0 })).toBe('error')
  })

  test('keeps stale content visible when a refresh fails', () => {
    expect(resolveWorkspaceLoadState({ loading: false, error: '刷新失败', itemCount: 2 })).toBe('ready')
  })

  test('uses empty only after loading finishes without an error', () => {
    expect(resolveWorkspaceLoadState({ loading: false, error: null, itemCount: 0 })).toBe('empty')
  })

  test('shows message synchronization while cached chat content is refreshing', () => {
    expect(shouldShowWorkspaceMessageSync({ loading: true, itemCount: 2 })).toBe(true)
    expect(shouldShowWorkspaceMessageSync({ loading: true, itemCount: 0 })).toBe(false)
    expect(shouldShowWorkspaceMessageSync({ loading: false, itemCount: 2 })).toBe(false)
  })
})
