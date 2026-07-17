import { beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyProjectCache } from '../../ui/src/stores/project-cache.ts'

const wsMock = vi.hoisted(() => ({
  request: vi.fn(async () => [] as unknown),
  on: vi.fn(() => () => undefined),
}))

vi.mock('../../ui/src/services/ws-client', () => ({ wsClient: wsMock }))

const { useFileSystemStore } = await import('../../ui/src/stores/filesystem.store.ts')
const { useRuleStore } = await import('../../ui/src/stores/rule.store.ts')
const { useKnowledgeBaseStore } = await import('../../ui/src/stores/knowledge-base.store.ts')
const { useEventCenterStore } = await import('../../ui/src/stores/event-center.store.ts')
const { useAgentMemoryStore } = await import('../../ui/src/stores/agent-memory.store.ts')
type FileEntry = import('../../ui/src/stores/filesystem.store.ts').FileEntry
type RuleData = import('../../ui/src/stores/rule.store.ts').RuleData
type KnowledgeBaseData = import('../../ui/src/stores/knowledge-base.store.ts').KnowledgeBaseData
type EventCenterEventData = import('../../ui/src/stores/event-center.store.ts').EventCenterEventData
type AgentMemoryDimensionData = import('../../ui/src/stores/agent-memory.store.ts').AgentMemoryDimensionData

function file(name: string): FileEntry {
  return { name, path: `/${name}`, type: 'file' }
}

function rule(id: string, projectId: string): RuleData {
  return {
    id,
    name: id,
    description: null,
    cron: '* * * * *',
    action: 'create_task',
    action_config: {},
    enabled: true,
    last_run_at: null,
    last_fail_at: null,
    next_run_at: null,
    run_count: 0,
    fail_count: 0,
    max_runs: null,
    created_by: null,
    trigger_type: 'cron',
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    project_id: projectId,
  }
}

function knowledgeBase(id: string, projectId: string): KnowledgeBaseData {
  return {
    id,
    name: id,
    kind: 'project',
    src: 'manual',
    icon: null,
    description: null,
    project_id: projectId,
    index_page_id: null,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    deleted_at: null,
  }
}

function event(id: string, projectId: string): EventCenterEventData {
  return {
    id,
    project_id: projectId,
    category_id: 'task.lifecycle',
    title: id,
    summary: null,
    source_type: 'test',
    source_id: null,
    source_label: null,
    priority: 'normal',
    confidence: 1,
    status: 'pending',
    tags_json: '[]',
    payload_json: '{}',
    evidence_json: '[]',
    dedupe_key: null,
    created_by_agent_id: null,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    archived_at: null,
  }
}

function dimension(id: string, projectId: string, agentId: string): AgentMemoryDimensionData {
  return {
    id,
    project_id: projectId,
    agent_id: agentId,
    name: id,
    description: null,
    prompt: null,
    created_at: '2026-07-17T00:00:00.000Z',
    updated_at: '2026-07-17T00:00:00.000Z',
    deleted_at: null,
  }
}

describe('secondary project caches', () => {
  beforeEach(() => {
    wsMock.request.mockReset()
    useFileSystemStore.setState({
      tree: [],
      openFile: null,
      loading: false,
      loadingFile: false,
      activeProjectId: null,
      projectCache: emptyProjectCache(),
    })
    useRuleStore.setState({
      rules: [],
      loading: false,
      refreshing: false,
      activeScope: '__all__',
      ruleCache: emptyProjectCache(),
    })
    useKnowledgeBaseStore.setState({
      knowledgeBases: [],
      pagesByKbId: {},
      currentKbId: null,
      currentPageId: null,
      currentRead: null,
      activities: [],
      searchResults: [],
      loading: false,
      pageLoading: false,
      isDirty: false,
      remoteUpdatePending: false,
      activeProjectId: null,
      projectCache: emptyProjectCache(),
    })
    useEventCenterStore.setState({
      events: [],
      categories: [],
      subscriptions: [],
      details: {},
      selectedEventId: null,
      activeProjectId: null,
      projectCache: emptyProjectCache(),
      loading: false,
    })
    useAgentMemoryStore.setState({
      dimensions: [],
      entries: [],
      currentEntry: null,
      loading: false,
      activeDimensionScope: null,
      activeEntryScope: null,
      dimensionCache: emptyProjectCache(),
      entryCache: emptyProjectCache(),
    })
  })

  test('restores file trees independently by project', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'fs.list') return []
      return msg.projectId === 'a' ? [file('a.ts')] : [file('b.ts')]
    })

    useFileSystemStore.getState().activateProject('a')
    await useFileSystemStore.getState().fetchTree('a', { force: true })
    useFileSystemStore.getState().activateProject('b')
    await useFileSystemStore.getState().fetchTree('b', { force: true })
    useFileSystemStore.getState().activateProject('a')

    expect(useFileSystemStore.getState().tree.map((item) => item.name)).toEqual(['a.ts'])
  })

  test('restores rule lists independently by project', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'rules.list') return []
      return msg.projectId === 'a' ? [rule('rule-a', 'a')] : [rule('rule-b', 'b')]
    })

    useRuleStore.getState().activateProject('a')
    await useRuleStore.getState().fetchRules('a', { force: true })
    useRuleStore.getState().activateProject('b')
    await useRuleStore.getState().fetchRules('b', { force: true })
    useRuleStore.getState().activateProject('a')

    expect(useRuleStore.getState().rules.map((item) => item.id)).toEqual(['rule-a'])
    expect(useRuleStore.getState().ruleCache.entries.b?.data.map((item) => item.id)).toEqual(['rule-b'])
  })

  test('restores knowledge base selection independently by project', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type === 'knowledgeBases.list') {
        const projectId = String(msg.projectId)
        return { knowledgeBases: [knowledgeBase(`kb-${projectId}`, projectId)] }
      }
      if (msg.type === 'knowledgePages.list') return { pages: [] }
      if (msg.type === 'knowledgeActivities.list') return { activities: [] }
      return []
    })

    useKnowledgeBaseStore.getState().activateProject('a')
    await useKnowledgeBaseStore.getState().fetchKnowledgeBases('a', { force: true })
    useKnowledgeBaseStore.getState().activateProject('b')
    await useKnowledgeBaseStore.getState().fetchKnowledgeBases('b', { force: true })
    useKnowledgeBaseStore.getState().activateProject('a')

    expect(useKnowledgeBaseStore.getState().knowledgeBases.map((item) => item.id)).toEqual(['kb-a'])
    expect(useKnowledgeBaseStore.getState().currentKbId).toBe('kb-a')
  })

  test('restores event center lists and selection independently by project', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'events.list') return []
      const projectId = String(msg.projectId)
      return [event(`event-${projectId}`, projectId)]
    })

    useEventCenterStore.getState().activateProject('a')
    await useEventCenterStore.getState().fetchEvents('a', { offset: 0 }, { force: true })
    useEventCenterStore.getState().activateProject('b')
    await useEventCenterStore.getState().fetchEvents('b', { offset: 0 }, { force: true })
    useEventCenterStore.getState().activateProject('a')

    expect(useEventCenterStore.getState().events.map((item) => item.id)).toEqual(['event-a'])
    expect(useEventCenterStore.getState().selectedEventId).toBe('event-a')
  })

  test('restores agent memory dimensions by project and agent scope', async () => {
    wsMock.request.mockImplementation(async (msg: Record<string, unknown>) => {
      if (msg.type !== 'agentMemory.dimensions.list') return []
      return { dimensions: [dimension(`dim-${msg.projectId}`, String(msg.projectId), String(msg.agentId))] }
    })

    await useAgentMemoryStore.getState().fetchDimensions('a', 'agent-a', { force: true })
    await useAgentMemoryStore.getState().fetchDimensions('b', 'agent-b', { force: true })
    useAgentMemoryStore.getState().activateScope('a', 'agent-a')

    expect(useAgentMemoryStore.getState().dimensions.map((item) => item.id)).toEqual(['dim-a'])
  })
})
