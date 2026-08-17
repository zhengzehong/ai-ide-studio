import { useState, type CSSProperties, type ReactNode } from 'react'
import { Bot, Clock3, Eye, Power, Save, X } from 'lucide-react'
import type { AgentItem } from '../stores/app.store'
import type { MobileSecretary } from '../stores/secretary.store'

interface SecretaryConfigSheetProps {
  secretary: MobileSecretary | null
  agents: AgentItem[]
  saving: boolean
  onSave: (input: Record<string, unknown>) => Promise<void>
  onClose: () => void
}

export function SecretaryConfigSheet({
  secretary,
  agents,
  saving,
  onSave,
  onClose,
}: SecretaryConfigSheetProps) {
  const [name, setName] = useState(secretary?.name ?? '')
  const [definitionPrompt, setDefinitionPrompt] = useState(secretary?.definitionPrompt ?? '')
  const [reportPrompt, setReportPrompt] = useState(secretary?.reportPrompt ?? '')
  const [executionAgentId, setExecutionAgentId] = useState(secretary?.executionAgentId ?? agents[0]?.id ?? '')
  const [observeAll, setObserveAll] = useState(secretary?.observeAll ?? true)
  const [observedAgentIds, setObservedAgentIds] = useState<string[]>(secretary?.observedAgentIds ?? [])
  const existingCron = secretary?.triggers.find((trigger) => trigger.type === 'cron')?.cron ?? ''
  const [cronEnabled, setCronEnabled] = useState(Boolean(existingCron))
  const [cron, setCron] = useState(existingCron)
  const [watchSessionDone, setWatchSessionDone] = useState(secretary ? hasTrigger(secretary, 'session_done') : true)
  const [watchTaskNeedsInput, setWatchTaskNeedsInput] = useState(secretary ? hasTrigger(secretary, 'task_needs_input') : false)
  const [enabled, setEnabled] = useState(secretary?.enabled ?? true)
  const [error, setError] = useState('')

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
    setError('')
    try {
      await onSave({
        name: name.trim(),
        definitionPrompt,
        reportPrompt,
        executionAgentId,
        observeAll,
        observedAgentIds: observeAll ? [] : observedAgentIds,
        watchSessionDone,
        watchTaskNeedsInput,
        cron: cronEnabled ? cron.trim() : '',
        ...(secretary ? { enabled } : {}),
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    }
  }

  const toggleObserved = (agentId: string): void => {
    setObservedAgentIds((current) => current.includes(agentId)
      ? current.filter((id) => id !== agentId)
      : [...current, agentId])
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <section style={styles.sheet} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header style={styles.header}>
          <span style={styles.mark}><Bot size={18} /></span>
          <div style={styles.heading}><strong>{secretary ? '编辑项目秘书' : '新建项目秘书'}</strong><small>定义职责、观察范围和触发条件</small></div>
          <button type="button" onClick={onClose} aria-label="关闭" style={styles.iconButton}><X size={20} /></button>
        </header>
        <div style={styles.body}>
          {secretary && <SettingRow icon={<Power size={16} />} title="启用状态" description={enabled ? '秘书正在接收触发事件' : '秘书已暂停运行'}><Switch checked={enabled} onChange={setEnabled} /></SettingRow>}

          <SectionTitle icon={<Bot size={16} />} title="秘书定义" />
          <Field label="名称"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：研发进展秘书" style={styles.input} /></Field>
          <Field label="秘书职责"><textarea value={definitionPrompt} onChange={(event) => setDefinitionPrompt(event.target.value)} placeholder="它长期负责什么？" rows={3} style={styles.textarea} /></Field>
          <Field label="汇报要求"><textarea value={reportPrompt} onChange={(event) => setReportPrompt(event.target.value)} placeholder="希望汇报什么、使用什么格式？" rows={3} style={styles.textarea} /></Field>
          <Field label="执行 Agent"><select value={executionAgentId} onChange={(event) => setExecutionAgentId(event.target.value)} style={styles.input}><option value="">选择 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></Field>

          <SectionTitle icon={<Eye size={16} />} title="观察范围" />
          <div style={styles.segmented}><button type="button" onClick={() => setObserveAll(true)} style={{ ...styles.segmentButton, ...(observeAll ? styles.segmentActive : {}) }}>全部 Agent</button><button type="button" onClick={() => setObserveAll(false)} style={{ ...styles.segmentButton, ...(!observeAll ? styles.segmentActive : {}) }}>指定 Agent</button></div>
          {!observeAll && <div style={styles.agentList}>{agents.map((agent) => <label key={agent.id} style={styles.agentRow}><input type="checkbox" checked={observedAgentIds.includes(agent.id)} onChange={() => toggleObserved(agent.id)} /><span>{agent.name}</span><small>{agent.type ?? 'Agent'}</small></label>)}</div>}

          <SectionTitle icon={<Clock3 size={16} />} title="触发条件" />
          <SettingRow title="会话完成后检查" description="观察到的 Agent 完成一轮会话后运行"><Switch checked={watchSessionDone} onChange={setWatchSessionDone} /></SettingRow>
          <SettingRow title="Task 需要处理时检查" description="Task 进入需确认或阻塞状态时运行"><Switch checked={watchTaskNeedsInput} onChange={setWatchTaskNeedsInput} /></SettingRow>
          <SettingRow title="定时检查" description="按照 Cron 表达式周期运行"><Switch checked={cronEnabled} onChange={setCronEnabled} /></SettingRow>
          {cronEnabled && <Field label="Cron 表达式"><input value={cron} onChange={(event) => setCron(event.target.value)} placeholder="0 9 * * *" style={styles.input} /></Field>}
          {error && <div style={styles.error}>{error}</div>}
        </div>
        <footer style={styles.footer}><button type="button" onClick={onClose} style={styles.secondary}>取消</button><button type="button" disabled={saving} onClick={() => void submit()} style={styles.primary}><Save size={15} /> {saving ? '保存中...' : '保存'}</button></footer>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={styles.field}><span>{label}</span>{children}</label>
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return <div style={styles.sectionTitle}>{icon}<strong>{title}</strong></div>
}

function SettingRow({ icon, title, description, children }: { icon?: ReactNode; title: string; description: string; children: ReactNode }) {
  return <div style={styles.settingRow}>{icon}<span><strong>{title}</strong><small>{description}</small></span>{children}</div>
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" aria-pressed={checked} aria-label={checked ? '关闭' : '开启'} onClick={() => onChange(!checked)} style={{ ...styles.switch, ...(checked ? styles.switchOn : {}) }}><i style={{ ...styles.switchThumb, ...(checked ? styles.switchThumbOn : {}) }} /></button>
}

function hasTrigger(secretary: MobileSecretary, type: string): boolean {
  return secretary.triggers.some((trigger) => trigger.type === type && trigger.enabled)
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', alignItems: 'flex-end', background: 'rgba(15,23,42,.38)' },
  sheet: { width: '100%', height: '94dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: '12px 12px 0 0', overflow: 'hidden' },
  header: { minHeight: 58, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)' },
  mark: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, color: 'var(--primary)', background: 'var(--primary-light)' },
  heading: { minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  iconButton: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, background: 'transparent', color: 'var(--text-primary)' },
  body: { minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 11, padding: 14, overflowY: 'auto' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, color: 'var(--text-secondary)', fontSize: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--text-secondary)', fontSize: 12 },
  input: { width: '100%', height: 38, boxSizing: 'border-box', padding: '0 10px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-primary)', font: 'inherit' },
  textarea: { width: '100%', boxSizing: 'border-box', padding: 10, border: '1px solid var(--border-light)', borderRadius: 6, resize: 'vertical', background: 'var(--bg)', color: 'var(--text-primary)', font: 'inherit', lineHeight: 1.5 },
  segmented: { display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 3, border: '1px solid var(--border-light)', borderRadius: 7, background: 'var(--bg)' },
  segmentButton: { height: 32, border: 0, borderRadius: 5, background: 'transparent', color: 'var(--text-muted)' },
  segmentActive: { color: 'var(--primary)', background: 'var(--bg-card)', boxShadow: '0 1px 3px rgba(15,23,42,.1)' },
  agentList: { maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-light)', borderRadius: 6 },
  agentRow: { minHeight: 42, display: 'grid', gridTemplateColumns: '20px minmax(0,1fr) auto', alignItems: 'center', gap: 7, padding: '0 10px', borderBottom: '1px solid var(--border-light)', color: 'var(--text-primary)', fontSize: 12 },
  settingRow: { minHeight: 48, display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--border-light)', color: 'var(--text-secondary)' },
  switch: { width: 38, height: 22, position: 'relative', flexShrink: 0, padding: 2, border: 0, borderRadius: 11, background: 'var(--border)' },
  switchOn: { background: 'var(--primary)' },
  switchThumb: { width: 18, height: 18, display: 'block', borderRadius: 9, background: '#fff', transition: 'transform .15s' },
  switchThumbOn: { transform: 'translateX(16px)' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 14px calc(12px + var(--safe-bottom))', borderTop: '1px solid var(--border-light)' },
  primary: { height: 36, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 14px', border: 0, borderRadius: 6, background: 'var(--primary)', color: '#fff' },
  secondary: { height: 36, padding: '0 14px', border: '1px solid var(--border-light)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-secondary)' },
  error: { padding: 9, borderRadius: 6, background: '#fff1f2', color: 'var(--error)', fontSize: 12 },
}
