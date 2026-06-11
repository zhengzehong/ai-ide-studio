import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface EventCategoryData {
  id: string
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
  fetchCategories: () => Promise<void>
  fetchEvents: (projectId?: string, filter?: EventListFilterInput) => Promise<void>
  fetchEventDetail: (eventId: string) => Promise<EventDetailData | null>
  fetchSubscriptions: (projectId?: string) => Promise<void>
  selectEvent: (eventId: string | null) => void
  createEvent: (input: Record<string, unknown>) => Promise<EventCenterEventData>
  createCategory: (input: Record<string, unknown>) => Promise<EventCategoryData>
  updateCategory: (input: Record<string, unknown>) => Promise<EventCategoryData>
  toggleCategory: (categoryId: string, enabled: boolean) => Promise<void>
  deleteCategory: (categoryId: string) => Promise<void>
  createSubscription: (input: Record<string, unknown>) => Promise<EventSubscriptionData>
  toggleSubscription: (subscriptionId: string, enabled: boolean) => Promise<void>
  ignoreEvent: (eventId: string) => Promise<void>
  archiveEvent: (eventId: string) => Promise<void>
  convertToTask: (eventId: string, input: { title: string; description?: string; projectId?: string }) => Promise<void>
  runConsumer: (eventId: string, projectId?: string) => Promise<void>
  setupListeners: () => () => void
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

  fetchCategories: async () => {
    const categories = await wsClient.request({ type: 'eventCategories.list' }) as EventCategoryData[]
    set({ categories })
  },

  fetchEvents: async (projectId, filter = {}) => {
    set({ loading: true, activeProjectId: projectId ?? null })
    try {
      const state = get()
      const status = filter.status ?? state.eventStatus
      const categoryId = filter.categoryId ?? state.eventCategoryId
      const keyword = filter.keyword ?? state.eventKeyword
      const limit = filter.limit ?? state.eventLimit
      const offset = filter.offset ?? state.eventOffset
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
      set((state) => ({
        events: page.items,
        eventTotal: page.total,
        eventLimit: page.limit,
        eventOffset: page.offset,
        eventStatus: status,
        eventCategoryId: categoryId,
        eventKeyword: keyword,
        loading: false,
        selectedEventId: page.items.some((event) => event.id === state.selectedEventId)
          ? state.selectedEventId
          : page.items[0]?.id ?? null,
      }))
    } catch {
      set({ loading: false })
    }
  },

  fetchEventDetail: async (eventId) => {
    const detail = await wsClient.request({ type: 'events.get', eventId }) as EventDetailData
    set((state) => ({ details: { ...state.details, [eventId]: detail } }))
    return detail
  },

  fetchSubscriptions: async (projectId) => {
    const msg: Record<string, unknown> = { type: 'eventSubscriptions.list' }
    if (projectId) msg.projectId = projectId
    const subscriptions = await wsClient.request(msg) as EventSubscriptionData[]
    set({ subscriptions })
  },

  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  createEvent: async (input) => {
    const event = await wsClient.request({ type: 'events.create', ...input }) as EventCenterEventData
    set((state) => ({ events: [event, ...state.events].slice(0, state.eventLimit), eventTotal: state.eventTotal + 1, selectedEventId: event.id }))
    return event
  },

  createCategory: async (input) => {
    const category = await wsClient.request({ type: 'eventCategories.create', ...input }) as EventCategoryData
    set((state) => ({ categories: [category, ...state.categories.filter((item) => item.id !== category.id)] }))
    return category
  },

  updateCategory: async (input) => {
    const category = await wsClient.request({ type: 'eventCategories.update', ...input }) as EventCategoryData
    set((state) => ({ categories: state.categories.map((item) => item.id === category.id ? category : item) }))
    return category
  },

  toggleCategory: async (categoryId, enabled) => {
    const category = await wsClient.request({ type: 'eventCategories.toggle', categoryId, enabled }) as EventCategoryData
    set((state) => ({ categories: state.categories.map((item) => item.id === category.id ? category : item) }))
  },

  deleteCategory: async (categoryId) => {
    await wsClient.request({ type: 'eventCategories.delete', categoryId })
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

  toggleSubscription: async (subscriptionId, enabled) => {
    const subscription = await wsClient.request({ type: 'eventSubscriptions.toggle', subscriptionId, enabled }) as EventSubscriptionData
    set((state) => ({ subscriptions: state.subscriptions.map((item) => item.id === subscriptionId ? subscription : item) }))
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

  runConsumer: async (eventId, projectId) => {
    const detail = get().details[eventId] ?? await get().fetchEventDetail(eventId)
    const pending = detail?.consumptions.find((item) => item.status === 'pending' && item.consumer_agent_id)
    if (!pending) throw new Error('没有可运行的待消费 Agent')
    await wsClient.request({ type: 'eventConsumptions.run', projectId, consumptionId: pending.id })
    await get().fetchEventDetail(eventId)
    await get().fetchEvents(get().activeProjectId ?? undefined)
  },

  setupListeners: () => wsClient.on('event-center:update', () => {
    const projectId = get().activeProjectId ?? undefined
    void get().fetchCategories()
    void get().fetchSubscriptions(projectId)
    void get().fetchEvents(projectId)
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
