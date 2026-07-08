import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Loader2, Pencil, Plus, Rocket, Search as SearchIcon, Sparkles, Trash2, X } from 'lucide-react'
import { useTemplateStore, type TemplateData } from '../stores/template.store'
import { useAgentStore } from '../stores/agent.store'
import { useGlobalAssistantStore } from '../stores/global-assistant.store'
import { useModelStore } from '../stores/model.store'
import { useProjectStore } from '../stores/project.store'
import { DeployTemplateModal } from '../components/agent-square/DeployTemplateModal'
import { TemplateEditor } from '../components/agent-square/TemplateEditor'
import { ICON_MAP, TYPE_FILTERS, TYPE_LABELS, RUNTIME_OPTIONS, type IconName } from '../components/agent-square/constants'
import { Field } from '../components/agent-square/Field'
import {
  btnOutline,
  btnPrimary,
  btnPrimarySmall,
  builtinBadge,
  cardStyle,
  customBadge,
  editorInput,
  iconBadge,
  iconButton,
  inputStyle,
  modalBackdrop,
  modalCard,
  skillTag,
} from '../components/agent-square/styles'

export default function AgentSquare() {
  const navigate = useNavigate()
  const templates = useTemplateStore((s) => s.templates)
  const createTemplate = useTemplateStore((s) => s.createTemplate)
  const updateTemplate = useTemplateStore((s) => s.updateTemplate)
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate)
  const getSkills = useTemplateStore((s) => s.getSkills)
  const deployTemplate = useAgentStore((s) => s.deployTemplate)
  const fetchAgents = useAgentStore((s) => s.fetchAgents)
  const setGlobalAssistantFromTemplate = useGlobalAssistantStore((s) => s.setFromTemplate)
  const settingTemplateIds = useGlobalAssistantStore((s) => s.settingTemplateIds)
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const selectProject = useProjectStore((s) => s.selectProject)

  const [filterType, setFilterType] = useState('')
  const [searchText, setSearchText] = useState('')
  const [editing, setEditing] = useState<TemplateData | null>(null)
  const [creating, setCreating] = useState(false)
  const [deploying, setDeploying] = useState<TemplateData | null>(null)
  const [globalConfiguring, setGlobalConfiguring] = useState<TemplateData | null>(null)
  const [successText, setSuccessText] = useState('')

  const filtered = templates.filter((template) => {
    if (filterType && template.type !== filterType) return false
    if (searchText && !template.name.includes(searchText) && !(template.description ?? '').includes(searchText)) return false
    return true
  })

  if (editing) {
    return <TemplateEditor template={editing} onSave={async (input) => { await updateTemplate(editing.id, input); setEditing(null) }} onCancel={() => setEditing(null)} />
  }

  if (creating) {
    return <TemplateEditor onSave={async (input) => { await createTemplate(input); setCreating(false) }} onCancel={() => setCreating(false)} />
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Agent 广场</h1>
          <p style={{ fontSize: 15, color: 'var(--text-3)', margin: '6px 0 0' }}>全局管理 Agent 模板；添加到项目或设为全局助理时可绑定模型档案。</p>
        </div>
        <button onClick={() => setCreating(true)} style={btnPrimary}>
          <Plus size={16} /> 创建模板
        </button>
      </div>

      {successText && <div style={{ padding: '10px 12px', border: '1px solid rgba(5,150,105,0.25)', background: 'var(--green-light)', color: 'var(--green)', borderRadius: 8, fontSize: 15, marginBottom: 16 }}>{successText}</div>}

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="搜索 Agent 模板..." style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TYPE_FILTERS.map((filter) => (
            <button key={filter.value} onClick={() => setFilterType(filter.value)} style={{ padding: '5px 12px', fontSize: 15, borderRadius: 16, border: '1px solid var(--border)', background: filterType === filter.value ? 'var(--blue)' : 'var(--bg-0)', color: filterType === filter.value ? '#fff' : 'var(--text-2)', cursor: 'pointer', transition: 'all 0.15s' }}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.map((template) => {
          const IconComp = ICON_MAP[template.icon as IconName] || Bot
          const skills = getSkills(template)
          return (
            <div key={template.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={iconBadge}><IconComp size={22} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{template.name}</div>
                  <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 2 }}>{template.runtime} · {TYPE_LABELS[template.type] || template.type}</div>
                </div>
                {template.is_builtin ? <span style={builtinBadge}>内置</span> : <span style={customBadge}>自定义</span>}
              </div>
              <p style={{ fontSize: 15, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.5 }}>{template.description || '暂无描述'}</p>
              {skills.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>{skills.map((skill) => <span key={skill} style={skillTag}>{skill}</span>)}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                <button onClick={() => setDeploying(template)} style={btnPrimarySmall}><Rocket size={13} /> 添加到项目</button>
                <button onClick={() => setGlobalConfiguring(template)} disabled={!!settingTemplateIds[template.id]} style={btnOutline}>
                  {settingTemplateIds[template.id] ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                  设为全局助理
                </button>
                <button onClick={() => setEditing(template)} style={btnOutline}><Pencil size={13} /> 编辑模板</button>
                {!template.is_builtin && <button onClick={() => { if (confirm(`确定删除模板「${template.name}」吗？`)) deleteTemplate(template.id) }} style={{ ...btnOutline, color: 'var(--red, #ef4444)', borderColor: 'var(--red, #ef4444)' }}><Trash2 size={13} /> 删除</button>}
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}><Bot size={40} style={{ marginBottom: 12, opacity: 0.3 }} /><p>暂无匹配的 Agent 模板</p></div>}

      {deploying && (
        <DeployTemplateModal
          template={deploying}
          projects={projects}
          currentProjectId={currentProjectId}
          onClose={() => setDeploying(null)}
          onDeploy={async (projectId, input) => {
            const agent = await deployTemplate(projectId, deploying.id, input)
            selectProject(projectId)
            await fetchAgents(projectId)
            setDeploying(null)
            setSuccessText(`已将「${agent.name}」添加到项目，可以在工作台新建会话。`)
          }}
          onOpenWorkspace={() => navigate('/workspace')}
        />
      )}

      {globalConfiguring && (
        <GlobalAssistantTemplateModal
          template={globalConfiguring}
          saving={!!settingTemplateIds[globalConfiguring.id]}
          onClose={() => setGlobalConfiguring(null)}
          onSave={async (input) => {
            await setGlobalAssistantFromTemplate(globalConfiguring.id, input)
            await fetchAgents()
            setGlobalConfiguring(null)
            setSuccessText(`已将「${input.name || globalConfiguring.name}」设为全局助理，可从右侧竖条打开。`)
          }}
        />
      )}
    </div>
  )
}

function GlobalAssistantTemplateModal({
  template,
  saving,
  onSave,
  onClose,
}: {
  template: TemplateData
  saving: boolean
  onSave: (input: { name?: string; runtime?: string; systemPrompt?: string; modelProfileId?: string | null }) => Promise<void>
  onClose: () => void
}) {
  const profiles = useModelStore((s) => s.profiles)
  const fetchProfiles = useModelStore((s) => s.fetchProfiles)
  const [name, setName] = useState(template.name)
  const [runtime, setRuntime] = useState(template.runtime)
  const [modelProfileId, setModelProfileId] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState(template.system_prompt)
  const availableProfiles = useMemo(
    () => profiles.filter((profile) => profile.enabled && profile.runtime === runtime),
    [profiles, runtime],
  )
  const defaultModelProfileId = availableProfiles.find((profile) => profile.is_default === 1)?.id ?? ''
  const selectedModelProfileId = modelProfileId === null
    ? defaultModelProfileId
    : availableProfiles.some((profile) => profile.id === modelProfileId)
      ? modelProfileId
      : ''

  useEffect(() => { fetchProfiles() }, [fetchProfiles])

  const submit = async () => {
    if (!name.trim() || saving) return
    await onSave({
      name: name.trim(),
      runtime,
      systemPrompt,
      modelProfileId: selectedModelProfileId || null,
    })
  }

  return (
    <>
      <div onClick={onClose} style={modalBackdrop} />
      <div style={modalCard}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>设为全局助理</h3>
            <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '5px 0 0' }}>全局助理独立运行，可单独绑定模型档案。</p>
          </div>
          <button onClick={onClose} style={iconButton}><X size={14} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="助理名称">
            <input value={name} onChange={(e) => setName(e.target.value)} style={editorInput} />
          </Field>
          <Field label="运行时">
            <select value={runtime} onChange={(e) => { setRuntime(e.target.value); setModelProfileId(null) }} style={editorInput}>
              {RUNTIME_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          {(runtime === 'claude' || runtime === 'codex') && (
            <Field label="模型档案">
              <select value={selectedModelProfileId} onChange={(e) => setModelProfileId(e.target.value)} style={editorInput}>
                <option value="">不绑定模型档案</option>
                {availableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.is_default ? '（默认）' : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="系统提示词快照">
            <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} style={{ ...editorInput, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={onClose} style={btnOutline}>取消</button>
            <button onClick={submit} disabled={saving || !name.trim()} style={{ ...btnPrimary, opacity: saving || !name.trim() ? 0.6 : 1 }}>
              {saving ? '保存中...' : '设为全局助理'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
