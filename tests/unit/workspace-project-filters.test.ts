import { describe, expect, test } from 'vitest'
import { filterAgentsByProject, filterSessionsByProject } from '../../ui/src/pages/workspace/helpers.ts'

describe('workspace project filters', () => {
  test('keeps only entities from the selected project', () => {
    const sessions = [
      { id: 'sess-a', project_id: 'proj-a' },
      { id: 'sess-b', project_id: 'proj-b' },
      { id: 'sess-global', project_id: null },
    ]
    const agents = [
      { id: 'agent-a', project_id: 'proj-a' },
      { id: 'agent-b', project_id: 'proj-b' },
      { id: 'agent-global', project_id: null },
    ]

    expect(filterSessionsByProject(sessions, 'proj-a').map((s) => s.id)).toEqual(['sess-a'])
    expect(filterAgentsByProject(agents, 'proj-a').map((a) => a.id)).toEqual(['agent-a'])
    expect(filterSessionsByProject(sessions, null)).toEqual([])
    expect(filterAgentsByProject(agents, undefined)).toEqual([])
  })
})
