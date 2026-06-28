import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useAgentStore } from '../../stores/agent.store'
import { useEventCenterStore, type EventSubscriptionData } from '../../stores/event-center.store'
import { useSessionStore } from '../../stores/session.store'
import { categoryFields, parseJson } from './helpers'

const priorityOptions = [
  { value: '', label: '不限' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

type ConsumerSessionMode = 'existing' | 'new_each' | 'new_fixed'
type PayloadFilterOp = 'eq' | 'isNull' | 'in'

interface PayloadFilterDraft {
  key: string
  op: PayloadFilterOp
  value: string
}

const sessionModeOptions: Array<{ value: ConsumerSessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
]

interface Props {
  open: boolean
  projectId: string | null
  subscription?: EventSubscriptionData
  onClose: () => void
}

export function SubscriptionCreateModal({ open, projectId, subscription, onClose }: Props) {
  if (!open) return null
  return <SubscriptionForm key={subscription?.id ?? 'new'} projectId={projectId} subscription={subscription} onClose={onClose} />
}

function SubscriptionForm({ projectId, subscription, onClose }: Omit<Props, 'open'>) {
  const categories = useEventCenterStore((s) => s.categories)
  const createSubscription = useEventCenterStore((s) => s.createSubscription)
  const updateSubscription = useEventCenterStore((s) => s.updateSubscription)
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const initialFilter = parseJson<Record<string, unknown>>(subscription?.filter_json, {})
  const initialPayload = parsePayloadFilters(initialFilter.payload)
  const [name, setName] = useState(subscription?.name ?? '')
  const [categoryId, setCategoryId] = useState(subscription?.category_id ?? categories.find((category) => category.enabled === 1)?.id ?? '')
  const [consumerAgentId, setConsumerAgentId] = useState(subscription?.consumer_agent_id ?? '')
  const [consumerSessionMode, setConsumerSessionMode] = useState<ConsumerSessionMode>(subscription?.consumer_session_mode ?? 'new_fixed')
  const [consumerSessionId, setConsumerSessionId] = useState(subscription?.consumer_session_id ?? '')
  const [autoStart, setAutoStart] = useState(subscription ? subscription.auto_start === 1 : false)
  const [priority, setPriority] = useState(typeof initialFilter.priority === 'string' ? initialFilter.priority : '')
  const [sourceType, setSourceType] = useState(typeof initialFilter.sourceType === 'string' ? initialFilter.sourceType : '')
  const [payloadFilters, setPayloadFilters] = useState<PayloadFilterDraft[]>(initialPayload)
  const [enabled, setEnabled] = useState(subscription ? subscription.enabled === 1 : true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isEdit = Boolean(subscription)
  const targetProjectId = subscription ? subscription.project_id ?? undefined : projectId ?? undefined

  const projectAgents = useMemo(
    () => agents.filter((agent) => !projectId || agent.project_id === projectId),
    [agents, projectId],
  )

  const consumerSessions = useMemo(
    () => sessions.filter((session) => (
      session.agent_id === consumerAgentId &&
      session.status === 'active' &&
      (!projectId || session.project_id === projectId)
    )),
    [consumerAgentId, projectId, sessions],
  )
  const filterableFields = useMemo(() => {
    const category = categories.find((item) => item.id === categoryId)
    return categoryFields(category).filter((field) => field.filter)
  }, [categories, categoryId])
  const categoryOptions = useMemo(
    () => categories.filter((category) => category.enabled === 1 || category.id === subscription?.category_id),
    [categories, subscription?.category_id],
  )

  useEffect(() => {
    void fetchSessions(undefined, projectId ?? undefined)
  }, [fetchSessions, projectId])

  const submit = async () => {
    setError('')
    if (!name.trim()) {
      setError('请填写规则名称')
      return
    }
    if (!categoryId) {
      setError('请选择事件类别')
      return
    }
    if (!consumerAgentId) {
      setError('请选择消费 Agent')
      return
    }
    if (consumerSessionMode === 'existing' && !consumerSessionId) {
      setError('请选择已有消费会话')
      return
    }

    const agent = projectAgents.find((item) => item.id === consumerAgentId)
    const payloadFilter = buildPayloadFilter(payloadFilters)
    setSubmitting(true)
    try {
      const payload = {
        projectId: targetProjectId,
        name: name.trim(),
        categoryId,
        consumerAgentId,
        consumerLabel: agent?.name,
        actionMode: 'create_pending',
        filter: {
          ...(priority ? { priority } : {}),
          ...(sourceType.trim() ? { sourceType: sourceType.trim() } : {}),
          ...(Object.keys(payloadFilter).length > 0 ? { payload: payloadFilter } : {}),
        },
        enabled,
        autoStart,
        consumerSessionMode,
        consumerSessionId: consumerSessionMode === 'existing' || consumerSessionMode === 'new_fixed' ? consumerSessionId || undefined : undefined,
      }
      if (subscription) await updateSubscription(subscription.id, payload)
      else await createSubscription(payload)
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存订阅规则失败')
    } finally {
      setSubmitting(false)
    }
  }

  const close = () => {
    if (submitting) return
    onClose()
  }

  const reset = () => {
    setName('')
    setConsumerAgentId('')
    setConsumerSessionMode('new_fixed')
    setConsumerSessionId('')
    setAutoStart(false)
    setPriority('')
    setSourceType('')
    setPayloadFilters([])
    setEnabled(true)
    setError('')
  }

  const addPayloadFilter = () => {
    const firstField = filterableFields[0]
    if (!firstField) return
    setPayloadFilters((items) => [...items, { key: firstField.key, op: 'eq', value: '' }])
  }

  const updatePayloadFilter = (index: number, patch: Partial<PayloadFilterDraft>) => {
    setPayloadFilters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  const removePayloadFilter = (index: number) => {
    setPayloadFilters((items) => items.filter((_, itemIndex) => itemIndex !== index))
  }

  return (
    <div className="ec-modal-backdrop" role="presentation">
      <div className="ec-modal ec-modal--narrow" role="dialog" aria-modal="true" aria-labelledby="subscription-create-title">
        <div className="ec-modal-head">
          <div>
            <h2 id="subscription-create-title">{isEdit ? '编辑订阅规则' : '新建订阅规则'}</h2>
            <p>定义哪些事件进入哪个 Agent 的待消费队列。</p>
          </div>
          <button className="ec-icon-btn" onClick={close} aria-label="关闭"><X size={16} /></button>
        </div>
        <div className="ec-modal-body">
          <label className="ec-field">
            <span>规则名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：AI 热门项目分析" />
          </label>
          <label className="ec-field">
            <span>事件类别</span>
            <select
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value)
                setPayloadFilters([])
              }}
            >
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label className="ec-field">
            <span>消费 Agent</span>
            <select
              value={consumerAgentId}
              onChange={(e) => {
                setConsumerAgentId(e.target.value)
                setConsumerSessionId('')
              }}
            >
              <option value="">请选择消费 Agent</option>
              {projectAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          {projectAgents.length === 0 && <div className="ec-form-error">当前项目还没有可消费事件的 Agent，请先在 Agent 广场创建或部署 Agent。</div>}
          <label className="ec-field">
            <span>消费会话</span>
            <select value={consumerSessionMode} onChange={(e) => setConsumerSessionMode(e.target.value as ConsumerSessionMode)}>
              {sessionModeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          {consumerSessionMode === 'existing' && (
            <label className="ec-field">
              <span>已有会话</span>
              <select value={consumerSessionId} onChange={(e) => setConsumerSessionId(e.target.value)}>
                <option value="">请选择已有会话</option>
                {consumerSessions.map((session) => (
                  <option key={session.id} value={session.id}>{session.title || session.id}</option>
                ))}
              </select>
            </label>
          )}
          {consumerSessionMode === 'existing' && consumerAgentId && consumerSessions.length === 0 && (
            <div className="ec-form-error">该 Agent 暂无可用会话，请先选择固定新会话或创建会话。</div>
          )}
          <label className="ec-field">
            <span>优先级过滤</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {priorityOptions.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="ec-field">
            <span>来源类型过滤</span>
            <input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="留空表示不限，例如 manual / agent / schedule" />
          </label>
          <label className="ec-checkbox">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>创建后立即启用</span>
          </label>
          <label className="ec-checkbox">
            <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
            <span>有新事件时自动消费</span>
          </label>
          {filterableFields.length > 0 && (
            <div className="ec-field">
              <span>字段过滤</span>
              <div className="ec-payload-filter-list">
                {payloadFilters.map((filter, index) => {
                  const field = filterableFields.find((item) => item.key === filter.key)
                  return (
                    <div className="ec-payload-filter-row" key={`${filter.key}-${index}`}>
                      <select
                        value={filter.key}
                        onChange={(e) => updatePayloadFilter(index, { key: e.target.value, value: '' })}
                      >
                        {filterableFields.map((item) => (
                          <option key={item.key} value={item.key}>{item.label}</option>
                        ))}
                      </select>
                      <select
                        value={filter.op}
                        onChange={(e) => updatePayloadFilter(index, { op: e.target.value as PayloadFilterOp })}
                      >
                        <option value="eq">=</option>
                        <option value="isNull">为空</option>
                        <option value="in">in</option>
                      </select>
                      {filter.op !== 'isNull' && field?.enumValues.length ? (
                        <select value={filter.value} onChange={(e) => updatePayloadFilter(index, { value: e.target.value })}>
                          <option value="">请选择</option>
                          {field.enumValues.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      ) : filter.op !== 'isNull' ? (
                        <input value={filter.value} onChange={(e) => updatePayloadFilter(index, { value: e.target.value })} placeholder={filter.op === 'in' ? '值1,值2,值3' : '过滤值'} />
                      ) : (
                        <input value="空值" disabled />
                      )}
                      <button className="ec-btn" type="button" onClick={() => removePayloadFilter(index)}>移除</button>
                    </div>
                  )
                })}
                <button className="ec-btn" type="button" onClick={addPayloadFilter}>添加字段过滤</button>
              </div>
            </div>
          )}
          {error && <div className="ec-form-error">{error}</div>}
        </div>
        <div className="ec-modal-actions">
          <button className="ec-btn" onClick={close} disabled={submitting}>取消</button>
          <button className="ec-btn ec-btn--primary" onClick={submit} disabled={submitting}>{submitting ? '保存中...' : isEdit ? '保存规则' : '创建规则'}</button>
        </div>
      </div>
    </div>
  )
}

function parsePayloadFilters(value: unknown): PayloadFilterDraft[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, filterValue]): PayloadFilterDraft[] => {
    if (filterValue === null) return [{ key, op: 'isNull' as const, value: '' }]
    if (isInFilter(filterValue)) return [{ key, op: 'in' as const, value: filterValue.in.join(',') }]
    if (typeof filterValue === 'string' || typeof filterValue === 'number' || typeof filterValue === 'boolean') {
      return [{ key, op: 'eq' as const, value: String(filterValue) }]
    }
    return []
  })
}

function isInFilter(value: unknown): value is { in: string[] } {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { in?: unknown }).in) &&
    (value as { in: unknown[] }).in.every((item) => typeof item === 'string')
}

function buildPayloadFilter(filters: PayloadFilterDraft[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const filter of filters) {
    if (!filter.key) continue
    if (filter.op === 'isNull') {
      payload[filter.key] = null
      continue
    }
    if (filter.op === 'in') {
      const values = filter.value.split(',').map((item) => item.trim()).filter(Boolean)
      if (values.length > 0) payload[filter.key] = { in: values }
      continue
    }
    if (filter.value.trim()) payload[filter.key] = filter.value.trim()
  }
  return payload
}
