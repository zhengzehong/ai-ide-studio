import { useState, useEffect } from 'react'
import {
  Server, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, CheckCircle2,
  Star, Loader2, Eye, EyeOff, AlertCircle,
} from 'lucide-react'
import { useModelStore, type ModelProviderData } from '../stores/model.store'

export default function Settings() {
  const { providers, fetchProviders, createProvider, updateProvider, toggleProvider, deleteProvider, setDefault, testProvider } = useModelStore()
  const [showForm, setShowForm] = useState(false)
  const [editProvider, setEditProvider] = useState<ModelProviderData | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; models?: string[]; error?: string; loading?: boolean }>>({})

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleTest = async (id: string) => {
    setTestResults(r => ({ ...r, [id]: { ok: false, loading: true } }))
    const result = await testProvider(id)
    setTestResults(r => ({ ...r, [id]: { ...result, loading: false } }))
  }

  return (
    <div style={{ padding: '28px 36px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>设置</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 14, margin: '6px 0 0' }}>管理模型供应商和全局配置</p>
      </div>

      {/* Section: Model Providers */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={18} style={{ color: 'var(--blue)' }} />
            模型供应商
          </h2>
          <button onClick={() => { setEditProvider(null); setShowForm(true) }} style={btn}>
            <Plus size={14} /> 添加
          </button>
        </div>

        {providers.length === 0 ? (
          <div style={emptyState}>
            <Server size={36} strokeWidth={1.5} />
            <p style={{ fontWeight: 600, margin: '12px 0 4px' }}>尚未添加模型供应商</p>
            <p style={{ fontSize: 13 }}>添加 OpenAI 或 Claude 协议的模型供应商开始使用</p>
            <button onClick={() => setShowForm(true)} style={{ ...btn, marginTop: 8 }}><Plus size={14} /> 添加供应商</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {providers.map(p => {
              const models: { id: string; name: string }[] = JSON.parse(p.models_json || '[]')
              const tr = testResults[p.id]
              const isOpenAI = p.protocol === 'openai'
              return (
                <div key={p.id} style={{ ...providerCard, opacity: p.enabled ? 1 : 0.6 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={providerIcon(isOpenAI)}>
                      {isOpenAI ? 'AI' : 'C'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{p.display_name}</span>
                        <span style={protoBadge(p.protocol)}>{isOpenAI ? 'OpenAI 兼容' : 'Claude'}</span>
                        {p.is_default ? <span style={defaultBadge}><Star size={10} fill="currentColor" /> 默认</span> : null}
                        {!p.enabled && <span style={disabledBadge}>已禁用</span>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 3, fontFamily: 'monospace' }}>{p.base_url}</div>

                      {/* Models */}
                      {models.length > 0 && (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                          {models.map(m => <span key={m.id} style={modelTag}>{m.name || m.id}</span>)}
                        </div>
                      )}

                      {/* Test Result */}
                      {tr && !tr.loading && (
                        <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {tr.ok ? (
                            <><CheckCircle2 size={14} color="#22c55e" /><span style={{ color: '#22c55e' }}>连接成功{tr.models ? `，${tr.models.length} 个模型` : ''}</span></>
                          ) : (
                            <><AlertCircle size={14} color="#ef4444" /><span style={{ color: '#ef4444' }}>{tr.error}</span></>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => handleTest(p.id)} disabled={tr?.loading} style={actionBtn} title="测试连接">
                        {tr?.loading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={15} />}
                      </button>
                      {!p.is_default && <button onClick={() => setDefault(p.id)} style={actionBtn} title="设为默认"><Star size={15} /></button>}
                      <button onClick={() => toggleProvider(p.id, !p.enabled)} style={{ ...actionBtn, color: p.enabled ? 'var(--green)' : 'var(--text-3)' }} title={p.enabled ? '禁用' : '启用'}>
                        {p.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                      </button>
                      <button onClick={() => { setEditProvider(p); setShowForm(true) }} style={actionBtn} title="编辑"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('确认删除？')) deleteProvider(p.id) }} style={{ ...actionBtn, color: 'var(--red)' }} title="删除"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <ProviderForm
          provider={editProvider}
          onClose={() => { setShowForm(false); setEditProvider(null) }}
          onCreate={createProvider}
          onUpdate={updateProvider}
        />
      )}
    </div>
  )
}

function ProviderForm({ provider, onClose, onCreate, onUpdate }: {
  provider: ModelProviderData | null
  onClose: () => void
  onCreate: (p: { name: string; displayName: string; protocol: string; baseUrl: string; apiKey: string; models?: { id: string; name: string }[] }) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const isEdit = !!provider
  const [name, setName] = useState(provider?.name ?? '')
  const [displayName, setDisplayName] = useState(provider?.display_name ?? '')
  const [protocol, setProtocol] = useState(provider?.protocol ?? 'openai')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? 'https://api.openai.com')
  const [apiKey, setApiKey] = useState(provider?.api_key ?? '')
  const [showKey, setShowKey] = useState(false)
  const [modelsStr, setModelsStr] = useState(() => {
    if (!provider?.models_json) return ''
    const arr: { id: string; name: string }[] = JSON.parse(provider.models_json)
    return arr.map(m => m.id).join('\n')
  })

  const handleSubmit = async () => {
    if (!name.trim() || !displayName.trim() || !baseUrl.trim()) return
    const models = modelsStr.split('\n').map(s => s.trim()).filter(Boolean).map(id => ({ id, name: id }))
    if (isEdit && provider) {
      await onUpdate(provider.id, { displayName, protocol, baseUrl, apiKey, models })
    } else {
      await onCreate({ name, displayName, protocol, baseUrl, apiKey, models })
    }
    onClose()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? '编辑模型供应商' : '添加模型供应商'}</h2>

        <div style={fGrid}>
          <label style={fLabel}>
            标识名
            <input value={name} onChange={e => setName(e.target.value)} style={fInput} placeholder="openai-main" disabled={isEdit} />
          </label>
          <label style={fLabel}>
            显示名称
            <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fInput} placeholder="OpenAI 主账号" />
          </label>
        </div>

        <div style={fGrid}>
          <label style={fLabel}>
            协议类型
            <select value={protocol} onChange={e => {
              setProtocol(e.target.value)
              setBaseUrl(e.target.value === 'claude' ? 'https://api.anthropic.com' : 'https://api.openai.com')
            }} style={fInput}>
              <option value="openai">OpenAI (兼容协议)</option>
              <option value="claude">Claude (Anthropic)</option>
            </select>
          </label>
          <label style={fLabel}>
            API Key
            <div style={{ position: 'relative' }}>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ ...fInput, paddingRight: 36 }} type={showKey ? 'text' : 'password'} placeholder="sk-..." />
              <button onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        </div>

        <label style={{ ...fLabel, marginTop: 12 }}>
          Base URL
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={fInput} />
        </label>

        <label style={{ ...fLabel, marginTop: 12 }}>
          模型列表 <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>（每行一个 model ID）</span>
          <textarea value={modelsStr} onChange={e => setModelsStr(e.target.value)} style={{ ...fInput, minHeight: 90, fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: 1.8 }} placeholder={'gpt-4o\ngpt-4o-mini\nclaude-sonnet-4-20250514'} />
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={btnGhost}>取消</button>
          <button onClick={handleSubmit} style={btn}>{isEdit ? '保存修改' : '添加供应商'}</button>
        </div>
      </div>
    </div>
  )
}

/* ── Styles ── */

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px',
  borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff',
  cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'opacity .15s',
}
const btnGhost: React.CSSProperties = {
  ...btn, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)',
}
const actionBtn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
  cursor: 'pointer', padding: '5px 7px', color: 'var(--text-2)', display: 'flex',
  transition: 'all .15s',
}
const providerCard: React.CSSProperties = {
  borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-1)',
  padding: '18px 20px', transition: 'box-shadow .2s',
}
const providerIcon = (isOpenAI: boolean): React.CSSProperties => ({
  width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 800, fontSize: 14, flexShrink: 0, letterSpacing: -0.5,
  background: isOpenAI ? '#ecfdf5' : '#fffbeb', color: isOpenAI ? '#059669' : '#d97706',
  border: `1.5px solid ${isOpenAI ? '#a7f3d0' : '#fde68a'}`,
})
const protoBadge = (p: string): React.CSSProperties => ({
  fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
  background: p === 'openai' ? '#ecfdf5' : '#fffbeb', color: p === 'openai' ? '#059669' : '#d97706',
})
const defaultBadge: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
  background: '#fefce8', color: '#ca8a04', display: 'inline-flex', alignItems: 'center', gap: 3,
}
const disabledBadge: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 500,
  background: 'var(--bg-2)', color: 'var(--text-3)',
}
const modelTag: React.CSSProperties = {
  fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'var(--bg-2)',
  color: 'var(--text-2)', fontFamily: 'var(--font-mono, monospace)', fontWeight: 500,
}
const emptyState: React.CSSProperties = {
  textAlign: 'center', padding: '48px 24px', color: 'var(--text-3)',
  border: '2px dashed var(--border)', borderRadius: 12, background: 'var(--bg-2)',
}
const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}
const modalBox: React.CSSProperties = {
  background: 'var(--bg-1)', borderRadius: 14, padding: '28px 28px 24px',
  width: 540, maxHeight: '85vh', overflow: 'auto',
  boxShadow: '0 24px 80px rgba(0,0,0,0.25)', border: '1px solid var(--border)',
}
const fGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }
const fLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }
const fInput: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
  fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color .15s',
}
