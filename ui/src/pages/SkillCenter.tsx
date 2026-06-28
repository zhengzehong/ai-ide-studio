import { useState, useEffect, useRef } from 'react'
import {
  BookOpen, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Upload, Eye, Search, X, Link, Unlink, FileText, Sparkles, Plug,
} from 'lucide-react'
import { useSkillStore, type SkillData, type SkillBindingData } from '../stores/skill.store'
import { useAgentStore } from '../stores/agent.store'
import { useProjectStore } from '../stores/project.store'

const TYPE_META: Record<string, { label: string; icon: typeof FileText; color: string; bg: string }> = {
  prompt: { label: '提示词', icon: Sparkles, color: '#7c3aed', bg: '#ede9fe' },
  file: { label: '文件', icon: FileText, color: '#2563eb', bg: '#dbeafe' },
  mcp: { label: 'MCP', icon: Plug, color: '#db2777', bg: '#fce7f3' },
}

const CAT_LABELS: Record<string, string> = {
  general: '通用', coding: '编程', review: '审查', architecture: '架构', writing: '写作', devops: 'DevOps',
}

export default function SkillCenter() {
  const { skills, bindings, fetchSkills, createSkill, updateSkill, toggleSkill, deleteSkill, setBinding, removeBinding } = useSkillStore()
  const agents = useAgentStore(s => s.agents)
  const projects = useProjectStore(s => s.projects)

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editSkill, setEditSkill] = useState<SkillData | null>(null)
  const [viewSkill, setViewSkill] = useState<SkillData | null>(null)

  useEffect(() => { fetchSkills() }, [fetchSkills])

  const filtered = skills.filter(s => {
    if (search && !s.display_name.includes(search) && !s.name.includes(search) && !s.description.includes(search)) return false
    if (filterType && s.type !== filterType) return false
    return true
  })

  const getBindings = (id: string): SkillBindingData[] => bindings.filter(b => b.skill_id === id)

  return (
    <div style={{ padding: '28px 36px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>技能中心</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 15, margin: '6px 0 0' }}>
            创建和管理 Agent 技能，提示词、文件或 MCP 工具均可作为技能绑定到 Agent
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setEditSkill(null); setShowForm(true) }} style={btn}>
            <Plus size={14} /> 创建技能
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {[
          { label: '全部', count: skills.length, color: 'var(--text-1)' },
          { label: '提示词', count: skills.filter(s => s.type === 'prompt').length, color: '#7c3aed' },
          { label: '文件', count: skills.filter(s => s.type === 'file').length, color: '#2563eb' },
          { label: 'MCP', count: skills.filter(s => s.type === 'mcp').length, color: '#db2777' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: 'var(--bg-2)', fontSize: 15 }}>
            <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
            <span style={{ color: 'var(--text-3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div style={searchBox}>
          <Search size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索技能..." style={searchInput} />
          {search && <button onClick={() => setSearch('')} style={clearBtn}><X size={14} /></button>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['', 'prompt', 'file', 'mcp'].map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              ...filterBtn,
              background: filterType === t ? 'var(--blue)' : 'var(--bg-2)',
              color: filterType === t ? '#fff' : 'var(--text-2)',
            }}>
              {t === '' ? '全部' : TYPE_META[t]?.label ?? t}
            </button>
          ))}
        </div>
      </div>

      {/* Card Grid */}
      {filtered.length === 0 ? (
        <div style={emptyState}>
          <BookOpen size={40} strokeWidth={1.5} />
          <p style={{ fontWeight: 600, margin: '12px 0 4px', fontSize: 15 }}>暂无技能</p>
          <p style={{ fontSize: 15 }}>创建你的第一个技能，赋予 Agent 更多能力</p>
          <button onClick={() => setShowForm(true)} style={{ ...btn, marginTop: 12 }}><Plus size={14} /> 创建技能</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {filtered.map(s => {
            const meta = TYPE_META[s.type] ?? TYPE_META.prompt
            const Icon = meta.icon
            const sBindings = getBindings(s.id)
            const preview = s.content.slice(0, 120)
            return (
              <div key={s.id} style={{ ...skillCard, opacity: s.enabled ? 1 : 0.55 }}>
                {/* Card Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, flexShrink: 0 }}>
                    <Icon size={18} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{s.display_name}</span>
                      <span style={{ fontSize: 12, padding: '2px 7px', borderRadius: 4, fontWeight: 600, background: meta.bg, color: meta.color }}>{meta.label}</span>
                      {s.is_builtin ? <span style={{ fontSize: 12, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--text-3)' }}>内置</span> : null}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 2 }}>
                      {CAT_LABELS[s.category] || s.category}
                      {sBindings.length > 0 && <span> · {sBindings.length} 个绑定</span>}
                    </div>
                  </div>
                </div>

                {/* Description / Preview */}
                {s.description && <p style={{ fontSize: 15, color: 'var(--text-2)', margin: '0 0 8px', lineHeight: 1.5 }}>{s.description}</p>}
                {preview && (
                  <div style={{ fontSize: 14, color: 'var(--text-3)', background: 'var(--bg-2)', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 54, overflow: 'hidden', marginBottom: 12 }}>
                    {preview}{s.content.length > 120 ? '...' : ''}
                  </div>
                )}

                {/* Bindings */}
                {sBindings.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                    {sBindings.slice(0, 4).map(b => (
                      <span key={b.id} style={bindChip(b.scope)}>
                        {b.scope === 'global' ? '全局' : b.scope === 'project' ? '项目' : 'Agent'}
                        {b.target_id && `: ${b.scope === 'agent' ? (agents.find(a => a.id === b.target_id)?.name ?? '?') : (projects.find(p => p.id === b.target_id)?.name ?? '?')}`}
                      </span>
                    ))}
                    {sBindings.length > 4 && <span style={{ fontSize: 13, color: 'var(--text-3)', padding: '3px 0' }}>+{sBindings.length - 4}</span>}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <button onClick={() => setViewSkill(s)} style={cardBtn} title="查看内容"><Eye size={14} /> 查看</button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => toggleSkill(s.id, !s.enabled)} style={{ ...cardIconBtn, color: s.enabled ? 'var(--green)' : 'var(--text-3)' }}>
                    {s.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  {!s.is_builtin && (
                    <>
                      <button onClick={() => { setEditSkill(s); setShowForm(true) }} style={cardIconBtn}><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('确认删除？')) deleteSkill(s.id) }} style={{ ...cardIconBtn, color: 'var(--red)' }}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <SkillForm
          skill={editSkill}
          onClose={() => { setShowForm(false); setEditSkill(null) }}
          onCreate={createSkill}
          onUpdate={updateSkill}
        />
      )}
      {viewSkill && (
        <SkillViewer
          skill={viewSkill}
          bindings={getBindings(viewSkill.id)}
          agents={agents}
          projects={projects}
          onClose={() => setViewSkill(null)}
          onBind={setBinding}
          onUnbind={removeBinding}
        />
      )}
    </div>
  )
}

/* ── Skill Form Modal ── */
function SkillForm({ skill, onClose, onCreate, onUpdate }: {
  skill: SkillData | null; onClose: () => void
  onCreate: (p: { name: string; displayName: string; description?: string; skillType?: string; content: string; category?: string; defaultScope?: string }) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const isEdit = !!skill
  const [name, setName] = useState(skill?.name ?? '')
  const [displayName, setDisplayName] = useState(skill?.display_name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [skillType, setSkillType] = useState(skill?.type ?? 'prompt')
  const [content, setContent] = useState(skill?.content ?? '')
  const [category, setCategory] = useState(skill?.category ?? 'general')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setContent(reader.result as string)
      if (!displayName) setDisplayName(file.name.replace(/\.[^.]+$/, ''))
      if (!name) setName(file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').toLowerCase())
    }
    reader.readAsText(file)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !displayName.trim()) return
    if (isEdit && skill) await onUpdate(skill.id, { displayName, description, skillType, content, category })
    else await onCreate({ name, displayName, description, skillType, content, category, defaultScope: 'global' })
    onClose()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modalBox, width: 640 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? '编辑技能' : '创建技能'}</h2>
        <div style={fGrid}>
          <label style={fLabel}>标识名<input value={name} onChange={e => setName(e.target.value)} style={fInput} disabled={isEdit} placeholder="code_reviewer" /></label>
          <label style={fLabel}>显示名称<input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fInput} placeholder="代码审查" /></label>
        </div>
        <div style={fGrid}>
          <label style={fLabel}>类型
            <select value={skillType} onChange={e => setSkillType(e.target.value)} style={fInput}>
              <option value="prompt">提示词</option><option value="file">文件</option><option value="mcp">MCP</option>
            </select>
          </label>
          <label style={fLabel}>分类
            <select value={category} onChange={e => setCategory(e.target.value)} style={fInput}>
              {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="custom">自定义</option>
            </select>
          </label>
        </div>
        <label style={{ ...fLabel, marginTop: 12 }}>描述<input value={description} onChange={e => setDescription(e.target.value)} style={fInput} placeholder="简短描述技能的用途" /></label>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ ...fLabel, margin: 0 }}>内容</label>
            <button onClick={() => fileRef.current?.click()} style={{ ...btnGhost, padding: '4px 10px', fontSize: 14 }}><Upload size={12} /> 从文件导入</button>
            <input ref={fileRef} type="file" accept=".md,.txt,.json" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <textarea value={content} onChange={e => setContent(e.target.value)} style={{ ...fInput, minHeight: 220, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.7 }} placeholder={'# 技能名称\n\n## 角色\n你是一个...\n\n## 规范\n- 规则1\n- 规则2'} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={btnGhost}>取消</button>
          <button onClick={handleSubmit} style={btn}>{isEdit ? '保存修改' : '创建技能'}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Skill Viewer Modal ── */
function SkillViewer({ skill, bindings: sBindings, agents, projects, onClose, onBind, onUnbind }: {
  skill: SkillData; bindings: SkillBindingData[]
  agents: { id: string; name: string }[]; projects: { id: string; name: string }[]
  onClose: () => void
  onBind: (id: string, scope: string, targetId?: string) => void
  onUnbind: (id: string, scope: string, targetId?: string) => void
}) {
  const meta = TYPE_META[skill.type] ?? TYPE_META.prompt
  const [addScope, setAddScope] = useState('global')
  const [addTarget, setAddTarget] = useState('')

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modalBox, width: 720 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, flexShrink: 0 }}>
            <meta.icon size={20} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{skill.display_name}</h2>
              <span style={{ fontSize: 13, padding: '2px 8px', borderRadius: 5, fontWeight: 600, background: meta.bg, color: meta.color }}>{meta.label}</span>
            </div>
            {skill.description && <p style={{ color: 'var(--text-3)', fontSize: 15, margin: '4px 0 0' }}>{skill.description}</p>}
          </div>
          <button onClick={onClose} style={{ ...cardIconBtn, padding: 6 }}><X size={18} /></button>
        </div>

        {/* Content */}
        <pre style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '16px 18px', fontSize: 15, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 360, overflow: 'auto', margin: '0 0 16px', lineHeight: 1.7, border: '1px solid var(--border)' }}>
          {skill.content || '(无内容)'}
        </pre>

        {/* Bindings */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-2)' }}>绑定关系</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {sBindings.map(b => (
              <div key={b.id} style={{ ...bindChip(b.scope), paddingRight: 4 }}>
                {b.scope === 'global' ? '全局' : b.scope === 'project' ? '项目' : 'Agent'}
                {b.target_id && `: ${b.scope === 'agent' ? (agents.find(a => a.id === b.target_id)?.name ?? b.target_id) : (projects.find(p => p.id === b.target_id)?.name ?? b.target_id)}`}
                <button onClick={() => onUnbind(skill.id, b.scope, b.target_id ?? undefined)} style={{ ...cardIconBtn, padding: 1, marginLeft: 2 }}><Unlink size={11} /></button>
              </div>
            ))}
            {sBindings.length === 0 && <span style={{ fontSize: 14, color: 'var(--text-3)' }}>暂无绑定</span>}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select value={addScope} onChange={e => { setAddScope(e.target.value); setAddTarget('') }} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 14 }}>
              <option value="global">全局</option><option value="project">项目</option><option value="agent">Agent</option>
            </select>
            {addScope === 'agent' && <select value={addTarget} onChange={e => setAddTarget(e.target.value)} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 14 }}><option value="">选择 Agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
            {addScope === 'project' && <select value={addTarget} onChange={e => setAddTarget(e.target.value)} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 14 }}><option value="">选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
            <button onClick={() => { if (addScope !== 'global' && !addTarget) return; onBind(skill.id, addScope, addScope === 'global' ? undefined : addTarget); setAddTarget('') }} style={{ ...btn, padding: '5px 12px', fontSize: 14 }}><Link size={12} /> 绑定</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Styles ── */
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600 }
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' }
const cardBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', fontSize: 14, cursor: 'pointer', color: 'var(--text-2)' }
const cardIconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, color: 'var(--text-3)', display: 'flex' }
const searchBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', flex: 1, maxWidth: 360 }
const searchInput: React.CSSProperties = { border: 'none', background: 'none', outline: 'none', fontSize: 15, flex: 1, color: 'var(--text-1)' }
const clearBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 2, borderRadius: 4 }
const filterBtn: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 15, fontWeight: 500, cursor: 'pointer' }
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '52px 24px', color: 'var(--text-3)', border: '2px dashed var(--border)', borderRadius: 12, background: 'var(--bg-2)' }
const skillCard: React.CSSProperties = { borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-1)', padding: '16px 18px', transition: 'box-shadow .2s' }
const bindChip = (scope: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 5, fontSize: 13, fontWeight: 500,
  background: scope === 'global' ? '#dbeafe' : scope === 'project' ? '#d1fae5' : '#fce7f3',
  color: scope === 'global' ? '#2563eb' : scope === 'project' ? '#059669' : '#db2777',
})
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
const modalBox: React.CSSProperties = { background: 'var(--bg-1)', borderRadius: 14, padding: '28px 28px 24px', width: 560, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)', border: '1px solid var(--border)' }
const fGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }
const fLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }
const fInput: React.CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', width: '100%', boxSizing: 'border-box' }
