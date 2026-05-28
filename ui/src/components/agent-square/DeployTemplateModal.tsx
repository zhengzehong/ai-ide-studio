import { useState } from 'react'
import { X } from 'lucide-react'
import type { TemplateData } from '../../stores/template.store'
import { RUNTIME_OPTIONS } from './constants'
import { btnOutline, btnPrimary, editorInput, iconButton, modalBackdrop, modalCard } from './styles'
import { Field } from './Field'

export function DeployTemplateModal({ template, projects, currentProjectId, onDeploy, onClose, onOpenWorkspace }: {
  template: TemplateData
  projects: { id: string; name: string }[]
  currentProjectId: string | null
  onDeploy: (projectId: string, input: { name?: string; runtime?: string; systemPrompt?: string }) => Promise<void>
  onClose: () => void
  onOpenWorkspace: () => void
}) {
  const [projectId, setProjectId] = useState(currentProjectId ?? projects[0]?.id ?? '')
  const [name, setName] = useState(template.name)
  const [runtime, setRuntime] = useState(template.runtime)
  const [systemPrompt, setSystemPrompt] = useState(template.system_prompt)
  const [saving, setSaving] = useState(false)

  const submit = async (openWorkspace: boolean) => {
    if (!projectId || !name.trim() || saving) return
    setSaving(true)
    try {
      await onDeploy(projectId, { name: name.trim(), runtime, systemPrompt })
      if (openWorkspace) onOpenWorkspace()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={modalCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>添加智能体到项目</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '5px 0 0' }}>模板会复制成项目级智能体，之后可独立配置。</p>
          </div>
          <button onClick={onClose} style={iconButton}><X size={14} /></button>
        </div>
        {projects.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>请先在左上角创建项目，再添加智能体。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="目标项目">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={editorInput}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="智能体名称">
              <input value={name} onChange={(e) => setName(e.target.value)} style={editorInput} />
            </Field>
            <Field label="运行时">
              <select value={runtime} onChange={(e) => setRuntime(e.target.value)} style={editorInput}>
                {RUNTIME_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="系统提示词快照">
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} style={{ ...editorInput, resize: 'vertical' }} />
            </Field>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={onClose} style={btnOutline}>取消</button>
              <button onClick={() => submit(false)} disabled={saving || !projectId || !name.trim()} style={{ ...btnOutline, opacity: saving ? 0.6 : 1 }}>添加</button>
              <button onClick={() => submit(true)} disabled={saving || !projectId || !name.trim()} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>{saving ? '添加中...' : '添加并打开工作台'}</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
