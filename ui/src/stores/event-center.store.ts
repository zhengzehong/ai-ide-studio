import { create } from 'zustand'
import { wsClient } from '../services/ws-client'
import {
  beginProjectRequest,
  clearProjectCache,
  commitProjectResponse,
  emptyProjectCache,
  invalidateProjectCache,
  pruneProjectCache,
  readProjectCache,
  shouldRefreshProjectCache,
  touchProjectCache,
  type ProjectCacheState,
} from './project-cache'

export interface EventCategoryData {
  id: string
  project_id: string | null
  scope_key: string
  name: string
  description: string | null
  schema_json: string
  default_priority: string
  allowed_writers_json: string
  allowed_consumers_json: string
  enabled: number
  created_at: string
  updated_at: string
}

export interface EventCenterEventData {
  id: string
  project_id: string | null
  category_id: string
  title: string
  summary: string | null
  source_type: string
  source_id: string | null
  source_label: string | null
  priority: string
  confidence: number
  status: string
  tags_json: string
  payload_json: string
  evidence_json: string
  dedupe_key: string | null
  created_by_agent_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface EventSubscriptionData {
  id: string
  project_id: string | null
  name: string
  category_id: string
  consumer_agent_id: string | null
  consumer_label: string | null
  action_mode: string
  filter_json: string
  enabled: number
  auto_start: number
  consumer_session_mode: 'existing' | 'new_each' | 'new_fixed'
  consumer_session_id: string | null
  created_at: string
  updated_at: string
}

export interface EventConsumptionData {
  id: string
  event_id: string
  subscription_id: string | null
  project_id: string | null
  consumer_agent_id: string | null
  consumer_label: string | null
  status: string
  result_summary: string | null
  result_json: string | null
  error: string | null
  session_id: string | null
  claimed_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface EventDetailData extends EventCenterEventData {
  consumptions: EventConsumptionData[]
}

export interface EventListFilterInput {
  status?: string
  categoryId?: string
  keyword?: string
  limit?: number
  offset?: number
}

interface EventListPageData {
  items: EventCenterEventData[]
  total: number
  limit: number
  offset: number
}

export interface EventCenterProjectSnapshot {
  categories: EventCategoryData[]
  events: EventCenterEventData[]
  eventTotal: number
  eventLimit: number
  eventOffset: number
  eventStatus: string
  eventCategoryId: string
  eventKeyword: string
  subscriptions: EventSubscriptionData[]
  details: Record<string, EventDetailData>
  selectedEventId: string | null
  eventsLoaded: boolean
}

interface EventCenterStore {
  categories: EventCategoryData[]
  events: EventCenterEventData[]
  eventTotal: number
  eventLimit: number
  eventOffset: number
  eventStatus: string
  eventCategoryId: string
  eventKeyword: string
  subscriptions: EventSubscriptionData[]
  details: Record<string, EventDetailData>
  selectedEventId: string | null
  loading: boolean
  activeProjectId: string | null
  projectCache: ProjectCacheState<EventCenterProjectSnapshot>
  activateProject: (projectId: string) => void
  invalidateProject: (projectId: string) => void
  clearProjectCache: (projectId: string) => void
  fetchCategories: (projectId?: string) => Promise<void>
  fetchEvents: (
    projectId?: string,
    filter?: EventListFilterInput,
    options?: { force?: boolean },
  ) => Promise<void>
  fetchEventDetail: (eventId: string) => Promise<EventDetailData | null>
  fetchSubscriptions: (projectId?: string) => Promise<void>
  selectEvent: (eventId: string | null) => void
  createEvent: (input: Record<string, unknown>) => Promise<EventCenterEventData>
  createCategory: (input: Record<string, unknown>, projectId?: string) => Promise<EventCategoryData>
  updateCategory: (input: Record<string, unknown>, projectId?: string) => Promise<EventCategoryData>
  toggleCategory: (categoryId: string, enabled: boolean, projectId?: string) => Promise<void>
  deleteCategory: (categoryId: string, projectId?: string) => Promise<void>
  createSubscription: (input: Record<string, unknown>) => Promise<EventSubscriptionData>
  updateSubscription: (subscriptionId: string, input: Record<string, unknown>) => Promise<EventSubscriptionData>
  toggleSubscription: (subscriptionId: string, enabled: boolean) => Promise<void>
  deleteSubscription: (subscriptionId: string) => Promise<void>
  ignoreEvent: (eventId: string) => Promise<void>
  archiveEvent: (eventId: string) => Promise<void>
  convertToTask: (eventId: string, input: { title: string; description?: string; projectId?: string }) => Promise<void>
  runConsumer: (eventId: string, projectId?: string, sessionId?: string) => Promise<void>
  setupListeners: () => () => void
}

const EMPTY_EVENT_SNAPSHOT: EventCenterProjectSnapshot = {
  categories: [],
  events: [],
  eventTotal: 0,
  eventLimit: 30,
  eventOffset: 0,
  eventStatus: 'all',
  eventCategoryId: 'all',
  eventKeyword: '',
  subscriptions: [],
  details: {},
  selectedEventId: null,
  eventsLoaded: false,
}

function updateEventSnapshot(
  cache: ProjectCacheState<EventCenterProjectSnapshot>,
  projectId: string,
  patch: Partial<EventCenterProjectSnapshot>,
): ProjectCacheState<EventCenterProjectSnapshot> {
  const entry = cache.entries[projectId]
  const now = Date.now()
  return {
    ...cache,
    entries: {
      ...cache.entries,
      [projectId]: {
        data: { ...(entry?.data ?? EMPTY_EVENT_SNAPSHOT), ...patch },
        fetchedAt: entry?.fetchedAt ?? now,
        lastAccessedAt: now,
        invalidated: false,
        error: null,
      },
    },
  }
}

export const useEventCenterStore = create<EventCenterStore>((set, get) => ({
  categories: [],
  events: [],
  eventTotal: 0,
  eventLimit: 30,
  eventOffset: 0,
  eventStatus: 'all',
  eventCategoryId: 'all',
  eventKeyword: '',
  subscriptions: [],
  details: {},
  selectedEventId: null,
  loading: false,
  activeProjectId: null,
  projectCache: emptyProjectCache<EventCenterProjectSnapshot>(),

  activateProject: (projectId) => set((state) => {
    const projectCache = pruneProjectCache(touchProjectCache(state.projectCache, projectId), projectId)
    const snapshot = readProjectCache(projectCache, projectId)?.data ?? EMPTY_EVENT_SNAPSHOT
    return { activeProjectId: projectId, projectCache, ...snapshot, loading: false }
  }),

  invalidateProject: (projectId) => set((state) => ({
    projectCache: invalidateProjectCache(state.projectCache, projectId),
  })),

  clearProjectCache: (projectId) => set((state) => ({
    projectCache: clearProjectCache(state.projectCache, projectId),
  })),

  fetchCategories: async (projectId) => {
    const msg: Record<string, unknown> = { type: 'eventCategories.list' }
    if (projectId) msg.projectId = projectId
    const categories = await wsClient.request(msg) as EventCategoryData[]
    if (!projectId) {
      set({ categories })
      return
    }
    set((state) => ({
      projectCache: updateEventSnapshot(state.projectCache, projectId, { categories }),
      categories: state.activeProjectId === projectId ? categories : state.categories,
    }))
  },

  fetchEvents: async (projectId, filter = {}, options) => {
    const scope = projectId ?? '__all__'
    const cached = readProjectCache(get().projectCache, scope)
    if (
      !options?.force
      && cached?.data.eventsLoaded
      && !shouldRefreshProjectCache(cached)
      && Object.keys(filter).length === 0
    ) return
    let requestSeq = 0
    set((state) => {
      const request = beginProjectRequest(state.projectCache, scope)
      requestSeq = request.requestSeq
      return {
        projectCache: request.state,
        loading: state.activeProjectId === projectId,
        activeProjectId: state.activeProjectId ?? projectId ?? null,
      }
    })
    try {
      const snapshot = cached?.data ?? EMPTY_EVENT_SNAPSHOT
      const status = filter.status ?? snapshot.eventStatus
      const categoryId = filter.categoryId ?? snapshot.eventCategoryId
      const keyword = filter.keyword ?? snapshot.eventKeyword
      const limit = filter.limit ?? snapshot.eventLimit
      const offset = filter.offset ?? snapshot.eventOffset
      const msg: Record<string, unknown> = { type: 'events.list' }
      if (projectId) msg.projectId = projectId
      if (status && status !== 'all') msg.status = status
      if (categoryId && categoryId !== 'all') msg.categoryId = categoryId
      if (keyword.trim()) msg.keyword = keyword.trim()
      msg.limit = limit
      msg.offset = offset
      const response = await wsClient.request(msg) as EventCenterEventData[] | EventListPageData
      const page = Array.isArray(response)
        ? { items: response, total: response.length, limit, offset }
        : response
      set((state) => {
        const current = readProjectCache(state.projectCache, scope)?.data ?? EMPTY_EVENT_SNAPSHOT
        const selectedEventId = page.items.some((event) => event.id === current.selectedEventId)
          ? current.selectedEventId
          : page.items[0]?.id ?? null
        const nextSnapshot: EventCenterProjectSnapshot = {
          ...current,
          events: page.items,
          eventTotal: page.total,
          eventLimit: page.limit,
          eventOffset: page.offset,
          eventStatus: status,
          eventCategoryId: categoryId,
          eventKeyword: keyword,
          selectedEventId,
          eventsLoaded: true,
        }
        const projectCache = pruneProjectCache(commitProjectResponse(state.projectCache, {
          scope,
          requestSeq,
          data: nextSnapshot,
        }), state.activeProjectId ?? scope)
        if (state.activeProjectId !== projectId) return { projectCache }
        return { projectCache, ...nextSnapshot, loading: false }
      })
    } catch {
      if (get().activeProjectId === projectId) set({ loading: false })
    }
  },

  fetchEventDetail: async (eventId) => {
    const detail = await wsClient.request({ type: 'events.get', eventId }) as EventDetailData
    set((state) => {
      const details = { ...state.details, [eventId]: detail }
      return {
        details,
        projectCache: state.activeProjectId
          ? updateEventSnapshot(state.projectCache, state.activeProjectId, { details })
          : state.projectCache,
      }
    })
    return detail
  },

  fetchSubscriptions: async (projectId) => {
    const msg: Record<string, unknown> = { type: 'eventSubscriptions.list' }
    if (projectId) msg.projectId = projectId
    const subscriptions = await wsClient.request(msg) as EventSubscriptionData[]
    if (!projectId) {
      set({ subscriptions })
      return
    }
    set((state) => ({
      projectCache: updateEventSnapshot(state.projectCache, projectId, { subscriptions }),
      subscriptions: state.activeProjectId === projectId ? subscriptions : state.subscriptions,
    }))
  },

  selectEvent: (eventId) => set((state) => ({
    selectedEventId: eventId,
    projectCache: state.activeProjectId
      ? updateEventSnapshot(state.projectCache, state.activeProjectId, { selectedEventId: eventId })
      : state.projectCache,
  })),

  createEvent: async (input) => {
    const event = await wsClient.request({ type: 'events.create', ...input }) as EventCenterEventData
    set((state) => ({ events: [event, ...state.events].slice(0, state.eventLimit), eventTotal: state.eventTotal + 1, selectedEventId: event.id }))
    return event
  },

  createCategory: async (input, projectId) => {
    const msg: Record<string, unknown> = { type: 'eventCategories.create', ...input }
    if (projectId) msg.projectId = projectId
    const category = await wsClient.request(msg) as EventCategoryData
    set((state) => ({ categories: [category, ...state.categories.filter((item) => item.id !== category.id)] }))
    return category
  },

  updateCategory: async (input, projectId) => {
    const msg: Record<string, unknown> = { type: 'eventCategories.update', ...input }
    if (projectId) msg.projectId = projectId
    const category = await wsClient.request(msg) as EventCategoryData
    set((state) => ({ categories: state.categories.map((item) => item.id === category.id ? category : item) }))
    return category
  },

  toggleCategory: async (categoryId, enabled, projectId) => {
    const msg: Record<string, unknown> = { type: 'eventCategories.toggle', categoryId, enabled }
    if (projectId) msg.projectId = projectId
    const category = await wsClient.request(msg) as EventCategoryData
    set((state) => ({ categories: state.categories.map((item) => item.id === category.id ? category : item) }))
  },

  deleteCategory: async (categoryId, projectId) => {
    const msg: Record<string, unknown> = { type: 'eventCategories.delete', categoryId }
    if (projectId) msg.projectId = projectId
    await wsClient.request(msg)
    set((state) => ({
      categories: state.categories.filter((item) => item.id !== categoryId),
      eventCategoryId: state.eventCategoryId === categoryId ? 'all' : state.eventCategoryId,
    }))
  },

  createSubscription: async (input) => {
    const subscription = await wsClient.request({ type: 'eventSubscriptions.create', ...input }) as EventSubscriptionData
    set((state) => ({ subscriptions: [subscription, ...state.subscriptions] }))
    return subscription
  },

  updateSubscription: async (subscriptionId, input) => {
    const subscription = await wsClient.request({ type: 'eventSubscriptions.update', subscriptionId, ...input }) as EventSubscriptionData
    set((state) => ({ subscriptions: state.subscriptions.map((item) => item.id === subscriptionId ? subscription : item) }))
    return subscription
  },

  toggleSubscription: async (subscriptionId, enabled) => {
    const subscription = await wsClient.request({ type: 'eventSubscriptions.toggle', subscriptionId, enabled }) as EventSubscriptionData
    set((state) => ({ subscriptions: state.subscriptions.map((item) => item.id === subscriptionId ? subscription : item) }))
  },

  deleteSubscription: async (subscriptionId) => {
    await wsClient.request({ type: 'eventSubscriptions.delete', subscriptionId })
    set((state) => ({ subscriptions: state.subscriptions.filter((item) => item.id !== subscriptionId) }))
  },

  ignoreEvent: async (eventId) => {
    const event = await wsClient.request({ type: 'events.ignore', eventId }) as EventCenterEventData
    setEvent(event)
  },

  archiveEvent: async (eventId) => {
    const event = await wsClient.request({ type: 'events.archive', eventId }) as EventCenterEventData
    setEvent(event)
  },

  convertToTask: async (eventId, input) => {
    await wsClient.request({ type: 'events.convertToTask', eventId, ...input })
    await get().fetchEvents(get().activeProjectId ?? undefined)
    await get().fetchEventDetail(eventId).catch(() => null)
  },

  runConsumer: async (eventId, projectId, sessionId) => {
    const detail = get().details[eventId] ?? await get().fetchEventDetail(eventId)
    const pending = detail?.consumptions.find((item) => item.status === 'pending' && item.consumer_agent_id)
    if (!pending) throw new Error('没有可运行的待消费 Agent')
    await wsClient.request({ type: 'eventConsumptions.run', projectId, consumptionId: pending.id, sessionId })
    await get().fetchEventDetail(eventId)
    await get().fetchEvents(get().activeProjectId ?? undefined)
  },

  setupListeners: () => wsClient.on('event-center:update', (msg) => {
    const projectId = typeof msg.projectId === 'string' ? msg.projectId : get().activeProjectId
    if (!projectId) return
    get().invalidateProject(projectId)
    if (projectId !== get().activeProjectId) return
    void get().fetchCategories(projectId)
    void get().fetchSubscriptions(projectId)
    void get().fetchEvents(projectId, {}, { force: true })
    const selectedEventId = get().selectedEventId
    if (selectedEventId) void get().fetchEventDetail(selectedEventId).catch(() => undefined)
  }),
}))

function setEvent(event: EventCenterEventData): void {
  useEventCenterStore.setState((state) => ({
    events: state.events.map((item) => item.id === event.id ? event : item),
    details: state.details[event.id] ? { ...state.details, [event.id]: { ...state.details[event.id], ...event } } : state.details,
  }))
}
