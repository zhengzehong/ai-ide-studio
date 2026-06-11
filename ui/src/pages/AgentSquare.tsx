import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Loader2, Pencil, Plus, Rocket, Search as SearchIcon, Sparkles, Trash2 } from 'lucide-react'
import { useTemplateStore, type TemplateData } from '../stores/template.store'
import { useAgentStore } from '../stores/agent.store'
import { useGlobalAssistantStore } from '../stores/global-assistant.store'
import { useProjectStore } from '../stores/project.store'
import { DeployTemplateModal } from '../components/agent-square/DeployTemplateModal'
import { TemplateEditor } from '../components/agent-square/TemplateEditor'
import { ICON_MAP, TYPE_FILTERS, TYPE_LABELS } from '../components/agent-square/constants'
import { btnOutline, btnPrimary, btnPrimarySmall, builtinBadge, cardStyle, customBadge, iconBadge, inputStyle, skillTag } from '../components/agent-square/styles'

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
  const [successText, setSuccessText] = useState('')

  const filtered = templates.filter((t) => {
    if (filterType && t.type !== filterType) return false
    if (searchText && !t.name.includes(searchText) && !(t.description ?? '').includes(searchText)) return false
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
          <p style={{ fontSize: 15, color: 'var(--text-3)', margin: '6px 0 0' }}>全局管理 Agent 模板；添加到项目后才能在工作台创建会话。</p>
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
          {TYPE_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilterType(f.value)} style={{ padding: '5px 12px', fontSize: 15, borderRadius: 16, border: '1px solid var(--border)', background: filterType === f.value ? 'var(--blue)' : 'var(--bg-0)', color: filterType === f.value ? '#fff' : 'var(--text-2)', cursor: 'pointer', transition: 'all 0.15s' }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.map((tpl) => {
          const IconComp = ICON_MAP[tpl.icon] || Bot
          const skills = getSkills(tpl)
          return (
            <div key={tpl.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={iconBadge}><IconComp size={22} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{tpl.name}</div>
                  <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 2 }}>{tpl.runtime} · {TYPE_LABELS[tpl.type] || tpl.type}</div>
                </div>
                {tpl.is_builtin ? <span style={builtinBadge}>内置</span> : <span style={customBadge}>自定义</span>}
              </div>
              <p style={{ fontSize: 15, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.5 }}>{tpl.description || '暂无描述'}</p>
              {skills.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>{skills.map((s) => <span key={s} style={skillTag}>{s}</span>)}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                <button onClick={() => setDeploying(tpl)} style={btnPrimarySmall}><Rocket size={13} /> 添加到项目</button>
                <button
                  onClick={async () => {
                    await setGlobalAssistantFromTemplate(tpl.id)
                    await fetchAgents()
                    setSuccessText(`已将「${tpl.name}」设为全局助理，可从右侧竖条打开。`)
                  }}
                  disabled={!!settingTemplateIds[tpl.id]}
                  style={btnOutline}
                >
                  {settingTemplateIds[tpl.id] ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                  设为全局助理
                </button>
                <button onClick={() => setEditing(tpl)} style={btnOutline}><Pencil size={13} /> 编辑模板</button>
                {!tpl.is_builtin && <button onClick={() => { if (confirm(`确定删除模板「${tpl.name}」吗？`)) deleteTemplate(tpl.id) }} style={{ ...btnOutline, color: 'var(--red, #ef4444)', borderColor: 'var(--red, #ef4444)' }}><Trash2 size={13} /> 删除</button>}
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
    </div>
  )
}
