import { useMemo, useState } from 'react'
import { Bot, Clock3, Eye, FileText, Power, Save, Search, X } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { SecretaryData } from '../../stores/secretary.store'
import './SecretaryConfigModal.css'

export function SecretaryConfigModal({
  secretary,
  agents,
  saving,
  onSave,
  onClose,
}: {
  secretary: SecretaryData | null
  agents: AgentData[]
  saving: boolean
  onSave: (input: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(secretary?.name ?? '')
  const [definitionPrompt, setDefinitionPrompt] = useState(secretary?.definitionPrompt ?? '')
  const [reportPrompt, setReportPrompt] = useState(secretary?.reportPrompt ?? '')
  const [executionAgentId, setExecutionAgentId] = useState(secretary?.executionAgentId ?? agents[0]?.id ?? '')
  const [observedAgentIds, setObservedAgentIds] = useState<string[]>(secretary?.observedAgentIds ?? [])
  const [observeAll, setObserveAll] = useState(secretary?.observeAll ?? true)
  const existingCron = secretary?.triggers.find((trigger) => trigger.type === 'cron')?.cron ?? ''
  const [cronEnabled, setCronEnabled] = useState(Boolean(existingCron))
  const [cron, setCron] = useState(existingCron)
  const [watchSessionDone, setWatchSessionDone] = useState(
    secretary ? hasTrigger(secretary, 'session_done') : true,
  )
  const [watchTaskNeedsInput, setWatchTaskNeedsInput] = useState(
    secretary ? hasTrigger(secretary, 'task_needs_input') : false,
  )
  const [enabled, setEnabled] = useState(secretary?.enabled ?? true)
  const [agentQuery, setAgentQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const visibleAgents = useMemo(() => {
    const query = agentQuery.trim().toLowerCase()
    return query ? agents.filter((agent) => agent.name.toLowerCase().includes(query)) : agents
  }, [agentQuery, agents])

  const toggleObserved = (agentId: string): void => {
    setObservedAgentIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
  }

  const submit = async (): Promise<void> => {
    if (!name.trim() || !executionAgentId) {
      setError('名称和执行 Agent 不能为空')
      return
    }
    if (!observeAll && observedAgentIds.length === 0) {
      setError('请选择至少一个观察 Agent')
      return
    }
    if (cronEnabled && cron.trim().split(/\s+/).length !== 5) {
      setError('Cron 表达式需要包含 5 个字段')
      return
    }
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        definitionPrompt,
        reportPrompt,
        executionAgentId,
        observeAll,
        observedAgentIds: observeAll ? [] : observedAgentIds,
        cron: cronEnabled ? cron.trim() : '',
        watchSessionDone,
        watchTaskNeedsInput,
        ...(secretary ? { enabled } : {}),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    }
  }

  const triggerSummary = [
    watchSessionDone ? '会话完成' : '',
    watchTaskNeedsInput ? 'Task 需处理' : '',
    cronEnabled && cron.trim() ? describeCron(cron.trim()) : '',
  ].filter(Boolean).join('、') || '仅手动运行'

  return (
    <div className="secretary-config-backdrop" onClick={onClose}>
      <section className="secretary-config-drawer" role="dialog" aria-modal="true" aria-labelledby="secretary-config-title" onClick={(event) => event.stopPropagation()}>
        <header className="secretary-config-header">
          <span className="secretary-config-mark"><Bot size={19} /></span>
          <div className="secretary-config-heading">
            <h2 id="secretary-config-title">{secretary ? '编辑项目秘书' : '新建项目秘书'}</h2>
            <p>定义它长期负责什么、观察谁，以及何时向你汇报。</p>
          </div>
          {secretary && (
            <button type="button" className={`secretary-status-toggle${enabled ? ' is-on' : ''}`} onClick={() => setEnabled((value) => !value)} aria-pressed={enabled}>
              <Power size={14} /> {enabled ? '已启用' : '已停用'}
            </button>
          )}
          <button type="button" className="secretary-config-icon" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>

        <div className="secretary-config-body">
          <section className="secretary-config-section">
            <div className="secretary-section-heading"><FileText size={16} /><div><strong>基本信息</strong><span>职责和汇报格式都可以自由定义</span></div></div>
            <label className="secretary-field" htmlFor="secretary-name"><span>名称</span><input id="secretary-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：研发进展秘书" /></label>
            <label className="secretary-field" htmlFor="secretary-definition"><span>秘书职责</span><textarea id="secretary-definition" value={definitionPrompt} onChange={(event) => setDefinitionPrompt(event.target.value)} placeholder="例如：持续关注开发进展，识别阻塞、风险和重要变化" rows={4} /></label>
            <label className="secretary-field" htmlFor="secretary-report"><span>汇报要求</span><textarea id="secretary-report" value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} placeholder="例如：先给结论，再说明影响、证据和建议动作" rows={4} /></label>
          </section>

          <section className="secretary-config-section">
            <div className="secretary-section-heading"><Bot size={16} /><div><strong>执行 Agent</strong><span>负责分析事件并生成秘书汇报</span></div></div>
            <label className="secretary-field" htmlFor="secretary-executor"><span>执行者</span><select id="secretary-executor" value={executionAgentId} onChange={(event) => setExecutionAgentId(event.target.value)}><option value="">选择 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime}</option>)}</select></label>
          </section>

          <section className="secretary-config-section">
            <div className="secretary-section-heading"><Eye size={16} /><div><strong>观察范围</strong><span>只接收当前项目内这些 Agent 的事件</span></div></div>
            <div className="secretary-segmented" aria-label="观察范围">
              <button type="button" className={observeAll ? 'is-active' : ''} onClick={() => setObserveAll(true)} aria-pressed={observeAll}>全部 Agent</button>
              <button type="button" className={!observeAll ? 'is-active' : ''} onClick={() => setObserveAll(false)} aria-pressed={!observeAll}>指定 Agent</button>
            </div>
            {!observeAll && <div className="secretary-agent-picker">
              <div className="secretary-agent-tools"><label><Search size={14} /><input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="搜索 Agent" /></label><span>已选择 {observedAgentIds.length}</span><button type="button" onClick={() => setObservedAgentIds(agents.map((agent) => agent.id))}>全选</button><button type="button" onClick={() => setObservedAgentIds([])}>清空</button></div>
              <div className="secretary-agent-grid">{visibleAgents.map((agent) => <label key={agent.id} className="secretary-agent-option"><input type="checkbox" checked={observedAgentIds.includes(agent.id)} onChange={() => toggleObserved(agent.id)} /><span><strong>{agent.name}</strong><small>{agent.runtime}</small></span></label>)}</div>
            </div>}
          </section>

          <section className="secretary-config-section">
            <div className="secretary-section-heading"><Clock3 size={16} /><div><strong>触发条件</strong><span>没有匹配条件时仍可手动运行</span></div></div>
            <TriggerToggle label="会话完成后检查" description="观察到的 Agent 完成一轮会话后运行" checked={watchSessionDone} onChange={setWatchSessionDone} />
            <TriggerToggle label="Task 需要处理时检查" description="Task 进入 needs_input 或 blocked 时运行" checked={watchTaskNeedsInput} onChange={setWatchTaskNeedsInput} />
            <TriggerToggle label="定时检查" description="按照 Cron 表达式周期运行" checked={cronEnabled} onChange={setCronEnabled} />
            {cronEnabled && <label className="secretary-field secretary-cron-field" htmlFor="secretary-cron"><span>Cron 表达式</span><input id="secretary-cron" value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" /><small>{cron.trim() ? describeCron(cron.trim()) : '例如：0 9 * * * 表示每天 09:00'}</small></label>}
          </section>
        </div>

        <footer className="secretary-config-footer">
          <div className="secretary-config-summary"><strong>保存后</strong><span>{observeAll ? '观察全部 Agent' : `观察 ${observedAgentIds.length} 个 Agent`} · {triggerSummary}</span>{error && <em>{error}</em>}</div>
          <button type="button" className="secretary-config-secondary" onClick={onClose}>取消</button>
          <button type="button" className="secretary-config-primary" disabled={saving} onClick={() => void submit()}><Save size={15} /> {saving ? '保存中...' : '保存秘书'}</button>
        </footer>
      </section>
    </div>
  )
}

function TriggerToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="secretary-trigger-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>
}

function hasTrigger(secretary: SecretaryData, type: string): boolean {
  return secretary.triggers.some((trigger) => trigger.type === type && trigger.enabled)
}

function describeCron(value: string): string {
  const match = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/.exec(value)
  return match ? `每天 ${match[2].padStart(2, '0')}:${match[1].padStart(2, '0')}` : `Cron：${value}`
}
