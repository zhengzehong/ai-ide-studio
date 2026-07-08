import { useState } from 'react'
import { ChevronLeft, Save, X } from 'lucide-react'
import type { CreateTemplateInput, TemplateData } from '../../stores/template.store'
import { RUNTIME_OPTIONS, TYPE_FILTERS } from './constants'
import { btnOutline, btnPrimary, editorInput } from './styles'
import { Field } from './Field'
import { AvatarUploader } from '../agent/AvatarUploader'
import { wsClient } from '../../services/ws-client'

interface TemplateEditorProps {
  template?: TemplateData
  onSave: (input: CreateTemplateInput) => Promise<void>
  onCancel: () => void
}

export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const [name, setName] = useState(template?.name ?? '')
  const [type, setType] = useState(template?.type ?? 'dev')
  const [runtime, setRuntime] = useState(template?.runtime ?? 'claude')
  const [icon, setIcon] = useState(template?.icon ?? 'bot')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(template?.avatar_url ?? null)
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState(template?.system_prompt ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [skillsText, setSkillsText] = useState(() => {
    if (!template?.skills_json) return ''
    try { return (JSON.parse(template.skills_json) as string[]).join(', ') } catch { return '' }
  })
  const [saving, setSaving] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSaving(true)
    setUploadError(null)
    try {
      let finalAvatarUrl: string | null | undefined = avatarUrl
      if (pendingDataUrl) {
        const ext = 'png'
        const res = await wsClient.request({
          type: 'assets.uploadTemp',
          base64: pendingDataUrl,
          ext,
        }) as { url?: string }
        finalAvatarUrl = res.url ?? null
      } else if (pendingDataUrl === null && avatarUrl === null && template?.avatar_url) {
        finalAvatarUrl = null
      }
      const skills = skillsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      await onSave({
        name,
        agentType: type,
        runtime,
        icon,
        avatarUrl: finalAvatarUrl,
        systemPrompt,
        description: description || undefined,
        skills: skills.length > 0 ? skills : undefined,
      })
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onCancel} style={{ ...btnOutline, padding: '4px 8px' }}>
            <ChevronLeft size={16} /> 返回广场
          </button>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text-1)' }}>
            {template ? `编辑模板：${template.name}` : '创建新模板'}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={btnOutline}><X size={14} /> 取消</button>
          <button onClick={handleSubmit} disabled={saving || !name.trim()} style={{ ...btnPrimary, opacity: saving || !name.trim() ? 0.5 : 1 }}>
            <Save size={14} /> {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '320px 1fr', gap: 0 }}>
        <div style={{ padding: 24, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} style={editorInput} placeholder="如：架构师" />
          </Field>
          <Field label="类型">
            <select value={type} onChange={(e) => setType(e.target.value)} style={editorInput}>
              {TYPE_FILTERS.filter((f) => f.value).map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </Field>
          <Field label="运行时">
            <select value={runtime} onChange={(e) => setRuntime(e.target.value)} style={editorInput}>
              {RUNTIME_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="头像">
            <AvatarUploader
              currentAvatarUrl={template?.avatar_url}
              currentIcon={icon}
              pendingDataUrl={pendingDataUrl}
              onPendingChange={setPendingDataUrl}
              onChange={(value) => {
                setIcon(value.icon)
                if (value.avatarUrl === null) setAvatarUrl(null)
              }}
            />
            {uploadError && <div style={{ fontSize: 12, color: 'var(--red, #dc2626)', marginTop: 6 }}>{uploadError}</div>}
          </Field>
          <Field label="描述">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...editorInput, height: 60, resize: 'vertical' }} placeholder="一句话描述 Agent 模板的能力" />
          </Field>
          <Field label="技能标签">
            <input value={skillsText} onChange={(e) => setSkillsText(e.target.value)} style={editorInput} placeholder="用逗号分隔，如：系统设计, API 设计" />
          </Field>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }}>系统提示词</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            style={{ flex: 1, fontFamily: 'var(--font-mono, "Fira Code", monospace)', fontSize: 15, lineHeight: 1.6, padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', resize: 'none', outline: 'none' }}
            placeholder={'编写 Agent 模板的系统提示词...\n\n例如：\n你是一位资深系统架构师。你的核心职责：\n- 分析需求并设计系统架构\n- 技术选型和方案评估'}
          />
          <div style={{ fontSize: 14, color: 'var(--text-3)' }}>
            添加到项目时会复制一份提示词快照，项目智能体后续可独立调整。
          </div>
        </div>
      </div>
    </div>
  )
}
