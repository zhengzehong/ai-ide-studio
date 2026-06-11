import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useEventCenterStore, type EventSubscriptionData } from '../../stores/event-center.store'
import { actionModeLabel, categoryName, parseJson, PRIORITY_META } from './helpers'
import { SubscriptionCreateModal } from './SubscriptionCreateModal'

export function SubscriptionPanel({ projectId }: { projectId: string | null }) {
  const categories = useEventCenterStore((s) => s.categories)
  const subscriptions = useEventCenterStore((s) => s.subscriptions)
  const toggleSubscription = useEventCenterStore((s) => s.toggleSubscription)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(subscriptions[0]?.id ?? null)
  const selected = subscriptions.find((item) => item.id === selectedId) ?? subscriptions[0]

  return (
    <div className="ec-manage">
      <section className="ec-table-pane">
        <div className="ec-list-toolbar ec-list-toolbar--between">
          <div>
            <strong>订阅规则</strong>
            <span>匹配事件后创建待消费记录，交给指定 Agent 处理。</span>
          </div>
          <button className="ec-btn ec-btn--primary" onClick={() => setCreating(true)}><Plus size={14} />新建订阅规则</button>
        </div>
        <div className="ec-table-scroll">
          <table className="ec-table">
            <thead><tr><th>规则</th><th>类别</th><th>消费 Agent</th><th>处理方式</th><th>状态</th></tr></thead>
            <tbody>
              {subscriptions.map((rule) => (
                <tr key={rule.id} className={rule.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(rule.id)}>
                  <td><strong>{rule.name}</strong></td>
                  <td>{categoryName(categories, rule.category_id)}</td>
                  <td>{rule.consumer_label || rule.consumer_agent_id || '-'}</td>
                  <td>{actionModeLabel(rule.action_mode)}</td>
                  <td><button className={rule.enabled ? 'ec-chip ec-chip--green' : 'ec-chip'} onClick={(e) => { e.stopPropagation(); void toggleSubscription(rule.id, !rule.enabled) }}>{rule.enabled ? '启用' : '停用'}</button></td>
                </tr>
              ))}
              {subscriptions.length === 0 && <tr><td colSpan={5}><div className="ec-empty">暂无订阅规则</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <RuleDetail rule={selected} />
      <SubscriptionCreateModal open={creating} projectId={projectId} onClose={() => setCreating(false)} />
    </div>
  )
}

function RuleDetail({ rule }: { rule: EventSubscriptionData | undefined }) {
  if (!rule) return <aside className="ec-side-panel"><div className="ec-empty">请选择一个订阅规则</div></aside>
  const filter = parseJson(rule.filter_json, {})
  const filterRows = readableFilter(filter)
  return (
    <aside className="ec-side-panel">
      <div className="ec-detail-head">
        <span className="ec-chip ec-chip--purple">{rule.enabled ? '启用' : '停用'}</span>
        <h2>{rule.name}</h2>
        <p>匹配事件后创建待消费记录，消费者可以从工具领取，或由 UI 手动运行。</p>
      </div>
      <div className="ec-detail-body">
        <section className="ec-section">
          <h3>匹配条件</h3>
          <div className="ec-kv">
            {filterRows.map((row) => <div className="ec-kv-row" key={row.label}><span>{row.label}</span><b>{row.value}</b></div>)}
          </div>
        </section>
        <section className="ec-section">
          <h3>消费配置</h3>
          <div className="ec-kv">
            <div className="ec-kv-row"><span>Agent</span><b>{rule.consumer_label || rule.consumer_agent_id || '-'}</b></div>
            <div className="ec-kv-row"><span>动作</span><b>{actionModeLabel(rule.action_mode)}</b></div>
            <div className="ec-kv-row"><span>自动启动</span><b>{rule.auto_start ? '是' : '否'}</b></div>
          </div>
        </section>
      </div>
    </aside>
  )
}

function readableFilter(filter: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = []
  if (typeof filter.priority === 'string') rows.push({ label: '优先级', value: PRIORITY_META[filter.priority]?.label ?? filter.priority })
  if (typeof filter.sourceType === 'string') rows.push({ label: '来源类型', value: filter.sourceType })
  return rows.length > 0 ? rows : [{ label: '条件', value: '匹配该类别的全部事件' }]
}
