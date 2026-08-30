import { beforeEach, describe, expect, test } from 'vitest'
import { MAX_PINNED, usePinnedProjects } from '../../ui/src/utils/project-meta.js'

describe('pinned project metadata', () => {
  beforeEach(() => {
    usePinnedProjects.setState({ pinnedIds: [] })
  })

  test('allows ten pinned projects without dropping existing tabs', () => {
    expect(MAX_PINNED).toBe(10)
    for (let index = 1; index <= 10; index += 1) {
      usePinnedProjects.getState().togglePin(`project-${index}`)
    }
    expect(usePinnedProjects.getState().pinnedIds).toEqual(
      Array.from({ length: 10 }, (_, index) => `project-${index + 1}`),
    )
  })

  test('replaces only the oldest project after the ten-project limit', () => {
    for (let index = 1; index <= 11; index += 1) {
      usePinnedProjects.getState().togglePin(`project-${index}`)
    }
    expect(usePinnedProjects.getState().pinnedIds).toEqual(
      Array.from({ length: 10 }, (_, index) => `project-${index + 2}`),
    )
  })
})
