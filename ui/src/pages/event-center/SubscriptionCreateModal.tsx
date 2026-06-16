import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useAgentStore } from '../../stores/agent.store'
import { useEventCenterStore } from '../../stores/event-center.store'
import { useSessionStore } from '../../stores/session.store'

const priorityOptions = [
  { value: '', label: '不限' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

type ConsumerSessionMode = 'existing' | 'new_each' | 'new_fixed'

const sessionModeOptions: Array<{ value: ConsumerSessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
]

interface Props {
  open: boolean
  projectId: string | null
  onClose: () => void
}

export function SubscriptionCreateModal({ open, projectId, onClose }: Props) {
  const categories = useEventCenterStore((s) => s.categories)
  const createSubscription = useEventCenterStore((s) => s.createSubscription)
  const agents = useAgentStore((s) => s.agents)
  const sessions = useSessionStore((s) => s.sessions)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('ai.hot_project')
  const [consumerAgentId, setConsumerAgentId] = useState('')
  const [consumerSessionMode, setConsumerSessionMode] = useState<ConsumerSessionMode>('new_fixed')
  const [consumerSessionId, setConsumerSessionId] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [priority, setPriority] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

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

  useEffect(() => {
    if (open) void fetchSessions(undefined, projectId ?? undefined)
  }, [fetchSessions, open, projectId])

  if (!open) return null

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
    setSubmitting(true)
    try {
      await createSubscription({
        projectId: projectId ?? undefined,
        name: name.trim(),
        categoryId,
        consumerAgentId,
        consumerLabel: agent?.name,
        actionMode: 'create_pending',
        filter: {
          ...(priority ? { priority } : {}),
          ...(sourceType.trim() ? { sourceType: sourceType.trim() } : {}),
        },
        enabled,
        autoStart,
        consumerSessionMode,
        consumerSessionId: consumerSessionMode === 'existing' ? consumerSessionId : undefined,
      })
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建订阅规则失败')
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
    setEnabled(true)
    setError('')
  }

  return (
    <div className="ec-modal-backdrop" role="presentation">
      <div className="ec-modal ec-modal--narrow" role="dialog" aria-modal="true" aria-labelledby="subscription-create-title">
        <div className="ec-modal-head">
          <div>
            <h2 id="subscription-create-title">新建订阅规则</h2>
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
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.filter((category) => category.enabled === 1).map((category) => (
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
          {error && <div className="ec-form-error">{error}</div>}
        </div>
        <div className="ec-modal-actions">
          <button className="ec-btn" onClick={close} disabled={submitting}>取消</button>
          <button className="ec-btn ec-btn--primary" onClick={submit} disabled={submitting}>{submitting ? '创建中...' : '创建规则'}</button>
        </div>
      </div>
    </div>
  )
}
