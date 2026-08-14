import { useState } from 'react'
import { Save, X } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { SecretaryData } from '../../stores/secretary.store'

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
  const [observedAgentIds, setObservedAgentIds] = useState<string[]>(secretary?.observedAgentIds ?? agents.map((agent) => agent.id))
  const [observeAll, setObserveAll] = useState(secretary?.observeAll ?? true)
  const [cron, setCron] = useState(secretary?.triggers.find((trigger) => trigger.type === 'cron')?.cron ?? '')
  const [watchTaskNeedsInput, setWatchTaskNeedsInput] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        definitionPrompt,
        reportPrompt,
        executionAgentId,
        observedAgentIds,
        observeAll,
        ...(secretary ? { cron: cron.trim() } : { cron: cron.trim() || undefined, watchSessionDone: true, watchTaskNeedsInput }),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <section style={styles.modal} onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <div><h2>{secretary ? '编辑项目秘书' : '新建项目秘书'}</h2><p>秘书只观察和处理当前项目。</p></div>
          <button type="button" onClick={onClose} aria-label="关闭" style={styles.iconButton}><X size={18} /></button>
        </header>
        <div style={styles.body}>
          <label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：研发进展秘书" /></label>
          <label>秘书定义<textarea value={definitionPrompt} onChange={(event) => setDefinitionPrompt(event.target.value)} placeholder="你希望这个秘书长期负责什么？" /></label>
          <label>汇报要求<textarea value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} placeholder="希望它汇报哪些内容、使用什么格式？" /></label>
          <label>执行 Agent<select value={executionAgentId} onChange={(event) => setExecutionAgentId(event.target.value)}>
            <option value="">选择 Agent</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime}</option>)}
          </select></label>
          <div>
            <strong style={styles.label}>观察 Agent</strong>
            <label style={styles.check}><input type="checkbox" checked={observeAll} onChange={(event) => setObserveAll(event.target.checked)} /> 观察当前项目全部 Agent</label>
            {!observeAll && agents.map((agent) => <label key={agent.id} style={styles.check}><input type="checkbox" checked={observedAgentIds.includes(agent.id)} onChange={() => toggleObserved(agent.id)} /> {agent.name}</label>)}
          </div>
          {!secretary && <>
            <label>定时 Cron（可选）<input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="例如：0 9 * * *" /></label>
            <label style={styles.check}><input type="checkbox" checked={watchTaskNeedsInput} onChange={(event) => setWatchTaskNeedsInput(event.target.checked)} /> Task 进入需处理时汇报</label>
          </>}
          {error && <div style={styles.error}>{error}</div>}
        </div>
        <footer style={styles.footer}><button type="button" onClick={onClose} style={styles.secondary}>取消</button><button type="button" disabled={saving} onClick={() => void submit()} style={styles.primary}><Save size={14} /> 保存</button></footer>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1800, background: 'rgba(15,23,42,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { width: 'min(620px, 100%)', maxHeight: 'min(760px, 100%)', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 20px 60px rgba(15,23,42,.22)' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' },
  body: { display: 'flex', flexDirection: 'column', gap: 12, padding: 20, overflowY: 'auto' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 20px', borderTop: '1px solid var(--border)' },
  iconButton: { border: 0, background: 'transparent', color: 'var(--text-2)', cursor: 'pointer', width: 30, height: 30 },
  primary: { display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, borderRadius: 6, padding: '0 12px', height: 32, background: 'var(--blue)', color: '#fff', cursor: 'pointer' },
  secondary: { border: '1px solid var(--border)', borderRadius: 6, padding: '0 12px', height: 32, background: 'var(--bg-1)', color: 'var(--text-2)', cursor: 'pointer' },
  check: { display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-2)', fontSize: 12 },
  label: { display: 'block', marginBottom: 7, fontSize: 12, color: 'var(--text-2)' },
  error: { padding: 9, borderRadius: 6, background: 'var(--red-light)', color: 'var(--red)', fontSize: 12 },
}
