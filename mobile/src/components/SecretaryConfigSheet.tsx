import { useState, type CSSProperties } from 'react'
import { Save, X } from 'lucide-react'
import type { AgentItem } from '../stores/app.store'

export default function SecretaryConfigSheet({
  agents,
  saving,
  onSave,
  onClose,
}: {
  agents: AgentItem[]
  saving: boolean
  onSave: (input: Record<string, unknown>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [definitionPrompt, setDefinitionPrompt] = useState('')
  const [reportPrompt, setReportPrompt] = useState('')
  const [executionAgentId, setExecutionAgentId] = useState(agents[0]?.id ?? '')
  const [cron, setCron] = useState('')
  const [error, setError] = useState('')

  const submit = async (): Promise<void> => {
    if (!name.trim() || !executionAgentId) { setError('名称和执行 Agent 不能为空'); return }
    setError('')
    try {
      await onSave({ name: name.trim(), definitionPrompt, reportPrompt, executionAgentId, observeAll: true, watchSessionDone: true, cron: cron.trim() || undefined })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败')
    }
  }

  return <div style={styles.overlay} onClick={onClose}><section style={styles.sheet} onClick={(event) => event.stopPropagation()}><header style={styles.header}><strong>新建项目秘书</strong><button type="button" onClick={onClose} aria-label="关闭" style={styles.close}><X size={20} /></button></header><div style={styles.body}><label>名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="研发进展秘书" /></label><label>秘书定义<textarea value={definitionPrompt} onChange={(event) => setDefinitionPrompt(event.target.value)} placeholder="它长期负责什么？" /></label><label>汇报要求<textarea value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} placeholder="希望汇报什么、使用什么格式？" /></label><label>执行 Agent<select value={executionAgentId} onChange={(event) => setExecutionAgentId(event.target.value)}><option value="">选择 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>定时 Cron（可选）<input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" /></label>{error && <div style={styles.error}>{error}</div>}</div><footer style={styles.footer}><button type="button" onClick={onClose} style={styles.secondary}>取消</button><button type="button" disabled={saving} onClick={() => void submit()} style={styles.primary}><Save size={15} /> 保存</button></footer></section></div>
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', alignItems: 'flex-end', background: 'rgba(0,0,0,.35)' },
  sheet: { width: '100%', maxHeight: '90%', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '14px 14px 0 0' },
  header: { minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' },
  close: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-primary)' },
  body: { display: 'flex', flexDirection: 'column', gap: 11, padding: 16, overflowY: 'auto' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 16px calc(12px + var(--safe-bottom))', borderTop: '1px solid var(--border-light)' },
  primary: { height: 34, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 12px', border: 0, borderRadius: 6, background: 'var(--primary)', color: '#fff' },
  secondary: { height: 34, padding: '0 12px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-secondary)' },
  error: { padding: 8, borderRadius: 6, background: '#fff1f2', color: 'var(--error)', fontSize: 12 },
}
