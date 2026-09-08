import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { wsClient } from '../../services/ws-client'

interface Props {
  open: boolean
  projectId: string | null
  onClose: () => void
  onCreated: (teamId: string) => void | Promise<void>
}

export function CreateTeamDialog({ open, projectId, onClose, onCreated }: Props) {
  if (!open) return null
  return <CreateTeamDialogBody projectId={projectId} onClose={onClose} onCreated={onCreated} />
}

function CreateTeamDialogBody({ projectId, onClose, onCreated }: Omit<Props, 'open'>) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [masterPrompt, setMasterPrompt] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptEdited = useRef(false)

  useEffect(() => {
    void wsClient.request({ type: 'teams.defaults' }).then((result) => {
      const prompt = result && typeof result === 'object' && typeof (result as { masterPrompt?: unknown }).masterPrompt === 'string'
        ? (result as { masterPrompt: string }).masterPrompt : ''
      setDefaultPrompt(prompt)
      if (!promptEdited.current) setMasterPrompt(prompt)
    }).catch(() => { setDefaultPrompt('') })
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!projectId || !name.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const result = await wsClient.request({ type: 'teams.create', projectId, name: name.trim(), description: description.trim() || undefined, masterPrompt: masterPrompt.trim() || undefined })
      const teamId = result && typeof result === 'object' && typeof (result as { team?: { id?: unknown } }).team?.id === 'string' ? (result as { team: { id: string } }).team.id : ''
      if (!teamId) throw new Error('创建团队失败')
      await onCreated(teamId); onClose()
    } catch (err) { setError(err instanceof Error ? err.message : '创建团队失败') } finally { setBusy(false) }
  }
  return <div role="dialog" aria-modal="true" onMouseDown={(event) => { if (!busy && event.currentTarget === event.target) onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', placeItems: 'center', background: 'rgb(15 23 42 / 35%)' }}>
    <form onSubmit={(event) => void submit(event)} style={{ width: 460, maxWidth: 'calc(100vw - 32px)', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}><strong>创建智能体团队</strong><button type="button" aria-label="关闭" disabled={busy} onClick={onClose} style={{ border: 0, background: 'transparent', color: 'var(--text-3)', cursor: busy ? 'not-allowed' : 'pointer' }}><X size={18} /></button></header>
      <label style={labelStyle}>团队名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Bug 修复团队" style={inputStyle} /></label>
      <label style={labelStyle}>团队描述<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="可选" style={inputStyle} /></label>
      <label style={labelStyle}>Master 提示词<textarea value={masterPrompt} onChange={(event) => { promptEdited.current = true; setMasterPrompt(event.target.value) }} rows={7} placeholder={defaultPrompt || '使用内置默认提示词'} style={{ ...inputStyle, resize: 'vertical' }} /></label>
      {defaultPrompt && <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: -6, marginBottom: 10 }}>已填充内置默认提示词，可直接修改。</div>}
      {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" disabled={busy} onClick={onClose} style={secondaryButton}>取消</button><button type="submit" disabled={!projectId || !name.trim() || busy} style={primaryButton}>{busy ? '创建中...' : '创建团队'}</button></footer>
    </form>
  </div>
}

const labelStyle = { display: 'grid', gap: 6, marginBottom: 12, color: 'var(--text-2)', fontSize: 13 }
const inputStyle = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', color: 'var(--text-1)', background: 'var(--bg-1)', font: 'inherit' }
const secondaryButton = { border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-2)', padding: '7px 14px', cursor: 'pointer' }
const primaryButton = { border: 0, borderRadius: 6, background: 'var(--blue)', color: '#fff', padding: '7px 14px', cursor: 'pointer' }
