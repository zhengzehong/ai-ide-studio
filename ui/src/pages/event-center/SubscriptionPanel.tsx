import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useAgentStore } from '../../stores/agent.store'
import { useEventCenterStore, type EventSubscriptionData } from '../../stores/event-center.store'
import { categoryName, parseJson } from './helpers'

export function SubscriptionPanel({ projectId }: { projectId: string | null }) {
  const categories = useEventCenterStore((s) => s.categories)
  const subscriptions = useEventCenterStore((s) => s.subscriptions)
  const createSubscription = useEventCenterStore((s) => s.createSubscription)
  const toggleSubscription = useEventCenterStore((s) => s.toggleSubscription)
  const agents = useAgentStore((s) => s.agents)
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('ai.hot_project')
  const [consumerAgentId, setConsumerAgentId] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(subscriptions[0]?.id ?? null)
  const selected = subscriptions.find((item) => item.id === selectedId) ?? subscriptions[0]

  const addRule = async () => {
    if (!name.trim() || !categoryId) return
    const agent = agents.find((item) => item.id === consumerAgentId)
    const subscription = await createSubscription({
      projectId: projectId ?? undefined,
      name: name.trim(),
      categoryId,
      consumerAgentId: consumerAgentId || undefined,
      consumerLabel: agent?.name,
      actionMode: 'create_pending',
      filter: { minConfidence: 0.7 },
    })
    setSelectedId(subscription.id)
    setName('')
  }

  return (
    <div className="ec-manage">
      <section className="ec-table-pane">
        <div className="ec-list-toolbar">
          <input className="ec-inline-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="订阅规则名称" />
          <select className="ec-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
          <select className="ec-select" value={consumerAgentId} onChange={(e) => setConsumerAgentId(e.target.value)}><option value="">选择消费者</option>{agents.filter((agent) => !projectId || agent.project_id === projectId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          <button className="ec-btn ec-btn--primary" onClick={addRule}><Plus size={14} />新建规则</button>
        </div>
        <div className="ec-table-scroll">
          <table className="ec-table">
            <thead><tr><th>规则</th><th>类别</th><th>消费 Agent</th><th>状态</th></tr></thead>
            <tbody>
              {subscriptions.map((rule) => (
                <tr key={rule.id} className={rule.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(rule.id)}>
                  <td><strong>{rule.name}</strong><small>{rule.action_mode}</small></td>
                  <td>{categoryName(categories, rule.category_id)}</td>
                  <td>{rule.consumer_label || rule.consumer_agent_id || '-'}</td>
                  <td><button className={rule.enabled ? 'ec-chip ec-chip--green' : 'ec-chip'} onClick={(e) => { e.stopPropagation(); void toggleSubscription(rule.id, !rule.enabled) }}>{rule.enabled ? '启用' : '停用'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <RuleDetail rule={selected} />
    </div>
  )
}

function RuleDetail({ rule }: { rule: EventSubscriptionData | undefined }) {
  if (!rule) return <aside className="ec-side-panel"><div className="ec-empty">请选择一个订阅规则</div></aside>
  const filter = parseJson(rule.filter_json, {})
  return (
    <aside className="ec-side-panel">
      <div className="ec-detail-head">
        <span className="ec-chip ec-chip--purple">{rule.enabled ? '启用' : '停用'}</span>
        <h2>{rule.name}</h2>
        <p>匹配事件后创建待消费记录，消费者可从工具领取。</p>
      </div>
      <div className="ec-detail-body">
        <section className="ec-section"><h3>匹配条件</h3><pre className="ec-code">{JSON.stringify(filter, null, 2)}</pre></section>
        <section className="ec-section"><h3>消费配置</h3><div className="ec-kv"><div className="ec-kv-row"><span>Agent</span><b>{rule.consumer_label || rule.consumer_agent_id || '-'}</b></div><div className="ec-kv-row"><span>动作</span><b>{rule.action_mode}</b></div><div className="ec-kv-row"><span>自动启动</span><b>{rule.auto_start ? '是' : '否'}</b></div></div></section>
      </div>
    </aside>
  )
}
