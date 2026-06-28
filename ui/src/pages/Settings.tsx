import { useState, useEffect } from 'react'
import {
  Server, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, CheckCircle2,
  Star, Loader2, Eye, EyeOff, AlertCircle, Cpu, Clock,
} from 'lucide-react'
import { useModelStore, type CodexProfileConfig, type ClaudeProfileConfig, type ModelProfileConfig, type ModelProfileData, type ModelProviderData } from '../stores/model.store'
import { useTimelineStore } from '../stores/timeline.store'
import { useProjectStore } from '../stores/project.store'

export default function Settings() {
  const {
    providers, profiles, fetchProviders, fetchProfiles, createProvider, updateProvider, toggleProvider, deleteProvider,
    setDefault, testProvider, createProfile, updateProfile, toggleProfile, setDefaultProfile, deleteProfile,
  } = useModelStore()
  const [showForm, setShowForm] = useState(false)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [editProvider, setEditProvider] = useState<ModelProviderData | null>(null)
  const [editProfile, setEditProfile] = useState<ModelProfileData | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; models?: string[]; error?: string; loading?: boolean }>>({})

  useEffect(() => { fetchProviders(); fetchProfiles() }, [fetchProviders, fetchProfiles])

  const handleTest = async (id: string) => {
    setTestResults(r => ({ ...r, [id]: { ok: false, loading: true } }))
    const result = await testProvider(id)
    setTestResults(r => ({ ...r, [id]: { ...result, loading: false } }))
  }

  return (
    <div style={{ padding: '28px 36px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>设置</h1>
        <p style={{ color: 'var(--text-3)', fontSize: 15, margin: '6px 0 0' }}>管理模型供应商和全局配置</p>
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
            <p style={{ fontSize: 15 }}>添加 OpenAI 或 Claude 协议的模型供应商开始使用</p>
            <button onClick={() => setShowForm(true)} style={{ ...btn, marginTop: 8 }}><Plus size={14} /> 添加供应商</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {providers.map(p => {
              const models: { id: string; name: string }[] = JSON.parse(p.models_json || '[]')
              const tr = testResults[p.id]
              const isOpenAI = p.protocol === 'openai'
              const isNewApi = p.protocol === 'new-api'
              return (
                <div key={p.id} style={{ ...providerCard, opacity: p.enabled ? 1 : 0.6 }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={providerIcon(isOpenAI || isNewApi)}>
                      {isNewApi ? 'NA' : isOpenAI ? 'AI' : 'C'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{p.display_name}</span>
                        <span style={protoBadge(p.protocol)}>{isOpenAI ? 'OpenAI 兼容' : 'Claude'}</span>
                        {p.is_default ? <span style={defaultBadge}><Star size={10} fill="currentColor" /> 默认</span> : null}
                        {!p.enabled && <span style={disabledBadge}>已禁用</span>}
                      </div>
                      <div style={{ fontSize: 15, color: 'var(--text-3)', marginTop: 3, fontFamily: 'monospace' }}>{p.base_url}</div>

                      {/* Models */}
                      {models.length > 0 && (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                          {models.map(m => <span key={m.id} style={modelTag}>{m.name || m.id}</span>)}
                        </div>
                      )}

                      {/* Test Result */}
                      {tr && !tr.loading && (
                        <div style={{ marginTop: 8, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
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

      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Cpu size={18} style={{ color: 'var(--blue)' }} />
            模型档案
          </h2>
          <button onClick={() => { setEditProfile(null); setShowProfileForm(true) }} style={btn}>
            <Plus size={14} /> 新建档案
          </button>
        </div>

        {profiles.length === 0 ? (
          <div style={emptyState}>
            <Cpu size={36} strokeWidth={1.5} />
            <p style={{ fontWeight: 600, margin: '12px 0 4px' }}>暂无模型档案</p>
            <p style={{ fontSize: 15 }}>为 Claude Code 或 Codex 创建可复用的模型配置</p>
            <button onClick={() => setShowProfileForm(true)} style={{ ...btn, marginTop: 8 }}><Plus size={14} /> 新建档案</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {profiles.map(profile => {
              const provider = providers.find(p => p.id === profile.provider_id)
              const config = parseProfileConfig(profile)
              return (
                <div key={profile.id} style={{ ...providerCard, opacity: profile.enabled ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={providerIcon(profile.runtime !== 'codex')}>{profile.runtime === 'codex' ? 'CX' : 'CC'}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{profile.name}</span>
                        <span style={protoBadge(profile.runtime === 'codex' ? 'claude' : 'openai')}>{profile.runtime === 'codex' ? 'Codex' : 'Claude Code'}</span>
                        {profile.is_default ? <span style={defaultBadge}><Star size={10} fill="currentColor" /> 默认</span> : null}
                        {!profile.enabled && <span style={disabledBadge}>已禁用</span>}
                      </div>
                      <div style={{ fontSize: 15, color: 'var(--text-3)', marginTop: 3 }}>
                        {provider?.display_name || profile.provider_id}
                        {profile.context_window ? ` · 上下文 ${formatContextWindow(profile.context_window)}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                        {profile.runtime === 'claude' ? renderClaudeTags(config as ClaudeProfileConfig) : renderCodexTags(config as CodexProfileConfig)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {!profile.is_default && profile.enabled === 1 && <button onClick={() => setDefaultProfile(profile.id)} style={actionBtn} title="设为默认档案"><Star size={15} /></button>}
                      <button onClick={() => toggleProfile(profile.id, !profile.enabled)} style={{ ...actionBtn, color: profile.enabled ? 'var(--green)' : 'var(--text-3)' }} title={profile.enabled ? '禁用' : '启用'}>
                        {profile.enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
                      </button>
                      <button onClick={() => { setEditProfile(profile); setShowProfileForm(true) }} style={actionBtn} title="编辑"><Pencil size={14} /></button>
                      <button onClick={() => { if (confirm('确认删除？')) deleteProfile(profile.id) }} style={{ ...actionBtn, color: 'var(--red)' }} title="删除"><Trash2 size={14} /></button>
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

      {showProfileForm && (
        <ProfileForm
          profile={editProfile}
          providers={providers.filter(p => p.enabled)}
          onClose={() => { setShowProfileForm(false); setEditProfile(null) }}
          onCreate={createProfile}
          onUpdate={updateProfile}
        />
      )}

      {/* Section: Timeline Config */}
      <TimelineConfigSection providers={providers.filter(p => p.enabled)} />
    </div>
  )
}

function TimelineConfigSection({ providers }: { providers: ModelProviderData[] }) {
  const { config, configLoading, fetchConfig, saveConfig } = useTimelineStore()
  const { currentProjectId } = useProjectStore()

  const [showKey, setShowKey] = useState(false)
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    model?: string
    apiKey?: string
    baseUrl?: string
    providerId?: string
    interval?: number
  }>({})

  useEffect(() => {
    if (currentProjectId) fetchConfig(currentProjectId)
  }, [currentProjectId, fetchConfig])

  const activeDraft = draftProjectId === currentProjectId ? draft : {}
  const localModel = activeDraft.model ?? config?.model ?? ''
  const localApiKey = activeDraft.apiKey ?? config?.api_key ?? ''
  const localBaseUrl = activeDraft.baseUrl ?? config?.base_url ?? ''
  const localProviderId = activeDraft.providerId ?? config?.provider_id ?? ''
  const localInterval = activeDraft.interval ?? config?.trigger_interval ?? 3
  const dirty = draftProjectId === currentProjectId && Object.keys(draft).length > 0
  const updateDraft = (fields: typeof draft) => {
    setDraftProjectId(currentProjectId)
    setDraft(prev => (draftProjectId === currentProjectId ? { ...prev, ...fields } : fields))
  }

  if (!currentProjectId) {
    return (
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} style={{ color: 'var(--blue)' }} />
          会话时间线
        </h2>
        <div style={{ color: 'var(--text-3)', fontSize: 15 }}>请先选择项目</div>
      </div>
    )
  }

  if (configLoading) {
    return (
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} style={{ color: 'var(--blue)' }} />
          会话时间线
        </h2>
        <div style={{ color: 'var(--text-3)', fontSize: 15 }}>加载中...</div>
      </div>
    )
  }

  const enabled = config?.enabled ?? 0
  const handleToggle = () => {
    saveConfig(currentProjectId, { enabled: enabled ? 0 : 1 })
  }

  const handleSave = () => {
    saveConfig(currentProjectId, {
      model: localModel.trim() || null,
      api_key: localApiKey.trim() || null,
      base_url: localBaseUrl.trim() || null,
      provider_id: localProviderId || null,
      trigger_interval: localInterval,
    })
    setDraft({})
    setDraftProjectId(null)
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} style={{ color: 'var(--blue)' }} />
          会话时间线
        </h2>
        <button onClick={handleToggle} style={{ ...actionBtn, color: enabled ? 'var(--green)' : 'var(--text-3)' }} title={enabled ? '禁用时间线' : '启用时间线'}>
          {enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
          <span style={{ fontSize: 13, marginLeft: 4 }}>{enabled ? '已启用' : '已关闭'}</span>
        </button>
      </div>

      <div style={{ ...providerCard, opacity: enabled ? 1 : 0.55 }}>
        <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '0 0 16px' }}>
          为当前项目配置时间线摘要模型。每完成指定轮数对话后，自动调用 LLM 整理会话时间线。
        </p>

        <div style={fGrid}>
          <label style={fLabel}>
            关联供应商
            <select
              value={localProviderId}
              onChange={e => { updateDraft({ providerId: e.target.value }) }}
              style={fInput}
              disabled={!enabled}
            >
              <option value="">手动配置（不关联）</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>选择已有供应商可复用其 API Key 和 Base URL</span>
          </label>
          <label style={fLabel}>
            模型名称
            <input
              value={localModel}
              onChange={e => { updateDraft({ model: e.target.value }) }}
              style={fInput}
              placeholder="gpt-4o-mini"
              disabled={!enabled}
            />
          </label>
        </div>

        {!localProviderId && (
          <div style={{ ...fGrid, marginTop: 12 }}>
            <label style={fLabel}>
              Base URL
              <input
                value={localBaseUrl}
                onChange={e => { updateDraft({ baseUrl: e.target.value }) }}
                style={fInput}
                placeholder="https://api.openai.com"
                disabled={!enabled}
              />
            </label>
            <label style={fLabel}>
              API Key
              <div style={{ position: 'relative' }}>
                <input
                  value={localApiKey}
                  onChange={e => { updateDraft({ apiKey: e.target.value }) }}
                  style={{ ...fInput, paddingRight: 36 }}
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  disabled={!enabled}
                />
                <button onClick={() => setShowKey(!showKey)} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex' }}>
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>
          </div>
        )}

        <div style={{ ...fGrid, marginTop: 12 }}>
          <label style={fLabel}>
            触发间隔（轮）
            <input
              value={localInterval}
              onChange={e => { updateDraft({ interval: Number(e.target.value) || 3 }) }}
              style={{ ...fInput, width: 100 }}
              type="number"
              min={1}
              max={20}
              disabled={!enabled}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>每 N 轮对话自动触发模型整理</span>
          </label>
        </div>

        {dirty && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={handleSave} style={btn}>保存配置</button>
          </div>
        )}
      </div>
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
              <option value="new-api">New API</option>
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
          <textarea value={modelsStr} onChange={e => setModelsStr(e.target.value)} style={{ ...fInput, minHeight: 90, fontFamily: 'var(--font-mono, monospace)', fontSize: 14, lineHeight: 1.8 }} placeholder={'gpt-4o\ngpt-4o-mini\nclaude-sonnet-4-20250514'} />
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

function ProfileForm({ profile, providers, onClose, onCreate, onUpdate }: {
  profile: ModelProfileData | null
  providers: ModelProviderData[]
  onClose: () => void
  onCreate: (p: { name: string; runtime: 'claude' | 'codex'; providerId: string; contextWindow?: number | null; config: ModelProfileConfig }) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const isEdit = !!profile
  const initialConfig = profile ? parseProfileConfig(profile) : {}
  const [name, setName] = useState(profile?.name ?? '')
  const [runtime, setRuntime] = useState<'claude' | 'codex'>(profile?.runtime ?? 'claude')
  const [providerId, setProviderId] = useState(profile?.provider_id ?? providers[0]?.id ?? '')
  const [contextWindow, setContextWindow] = useState(profile?.context_window ? String(profile.context_window) : '')
  const [defaultModel, setDefaultModel] = useState((initialConfig as ClaudeProfileConfig).defaultModel ?? '')
  const [haikuModel, setHaikuModel] = useState((initialConfig as ClaudeProfileConfig).haikuModel ?? '')
  const [sonnetModel, setSonnetModel] = useState((initialConfig as ClaudeProfileConfig).sonnetModel ?? '')
  const [opusModel, setOpusModel] = useState((initialConfig as ClaudeProfileConfig).opusModel ?? '')
  const [codexModel, setCodexModel] = useState((initialConfig as CodexProfileConfig).model ?? '')
  const [effort, setEffort] = useState((initialConfig as CodexProfileConfig).effort ?? 'medium')

  const handleRuntimeChange = (next: 'claude' | 'codex') => {
    setRuntime(next)
    if (!isEdit) {
      setDefaultModel('')
      setHaikuModel('')
      setSonnetModel('')
      setOpusModel('')
      setCodexModel('')
      setEffort('medium')
    }
  }

  const handleSubmit = async () => {
    if (!name.trim() || !providerId) return
    const context = contextWindow.trim() ? Number(contextWindow) : null
    const config: ModelProfileConfig = runtime === 'claude'
      ? {
        defaultModel: defaultModel.trim(),
        haikuModel: haikuModel.trim() || undefined,
        sonnetModel: sonnetModel.trim() || undefined,
        opusModel: opusModel.trim() || undefined,
      }
      : { model: codexModel.trim(), effort }
    if (runtime === 'claude' && !(config as ClaudeProfileConfig).defaultModel) return
    if (runtime === 'codex' && !(config as CodexProfileConfig).model) return
    if (isEdit && profile) {
      await onUpdate(profile.id, { name: name.trim(), runtime, providerId, contextWindow: context, config })
    } else {
      await onCreate({ name: name.trim(), runtime, providerId, contextWindow: context, config })
    }
    onClose()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? '编辑模型档案' : '新建模型档案'}</h2>
        <div style={fGrid}>
          <label style={fLabel}>档案名称<input value={name} onChange={e => setName(e.target.value)} style={fInput} placeholder="Claude 高配编程" /></label>
          <label style={fLabel}>运行时<select value={runtime} onChange={e => handleRuntimeChange(e.target.value as 'claude' | 'codex')} style={fInput}><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
        </div>
        <div style={fGrid}>
          <label style={fLabel}>模型供应商<select value={providerId} onChange={e => setProviderId(e.target.value)} style={fInput}><option value="">选择供应商</option>{providers.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}</select></label>
          <label style={fLabel}>模型上下文<input value={contextWindow} onChange={e => setContextWindow(e.target.value)} style={fInput} inputMode="numeric" placeholder="例如 200000" /></label>
        </div>
        {runtime === 'claude' ? (
          <>
            <label style={{ ...fLabel, marginTop: 12 }}>默认模型<input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} style={fInput} placeholder="deepseek-v4-pro[1m]" /></label>
            <div style={fGrid}>
              <label style={fLabel}>Haiku 轻量模型<input value={haikuModel} onChange={e => setHaikuModel(e.target.value)} style={fInput} placeholder="deepseek-v4-flash" /></label>
              <label style={fLabel}>Sonnet 主力模型<input value={sonnetModel} onChange={e => setSonnetModel(e.target.value)} style={fInput} placeholder="deepseek-v4-pro[1m]" /></label>
            </div>
            <label style={{ ...fLabel, marginTop: 12 }}>Opus 强力模型<input value={opusModel} onChange={e => setOpusModel(e.target.value)} style={fInput} placeholder="deepseek-v4-pro[1m]" /></label>
          </>
        ) : (
          <div style={fGrid}>
            <label style={fLabel}>默认模型<input value={codexModel} onChange={e => setCodexModel(e.target.value)} style={fInput} placeholder="deepseek-v4-flash" /></label>
            <label style={fLabel}>推理强度<select value={effort} onChange={e => setEffort(e.target.value)} style={fInput}><option value="none">none</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={btnGhost}>取消</button>
          <button onClick={handleSubmit} style={btn}>{isEdit ? '保存修改' : '创建档案'}</button>
        </div>
      </div>
    </div>
  )
}

function parseProfileConfig(profile: ModelProfileData): ModelProfileConfig {
  try {
    return JSON.parse(profile.config_json) as ModelProfileConfig
  } catch {
    return profile.runtime === 'claude' ? { defaultModel: '' } : { model: '', effort: 'medium' }
  }
}

function formatContextWindow(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}K` : String(value)
}

function renderClaudeTags(config: ClaudeProfileConfig): React.ReactNode[] {
  return [
    <span key="default" style={modelTag}>默认 {config.defaultModel || '-'}</span>,
    <span key="haiku" style={modelTag}>Haiku {config.haikuModel || '-'}</span>,
    <span key="sonnet" style={modelTag}>Sonnet {config.sonnetModel || '-'}</span>,
    <span key="opus" style={modelTag}>Opus {config.opusModel || '-'}</span>,
  ]
}

function renderCodexTags(config: CodexProfileConfig): React.ReactNode[] {
  return [
    <span key="model" style={modelTag}>{config.model || '-'}</span>,
    <span key="effort" style={modelTag}>effort {config.effort || 'medium'}</span>,
  ]
}

const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px',
  borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff',
  cursor: 'pointer', fontSize: 15, fontWeight: 600, transition: 'opacity .15s',
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
  fontWeight: 800, fontSize: 15, flexShrink: 0, letterSpacing: -0.5,
  background: isOpenAI ? '#ecfdf5' : '#fffbeb', color: isOpenAI ? '#059669' : '#d97706',
  border: `1.5px solid ${isOpenAI ? '#a7f3d0' : '#fde68a'}`,
})
const protoBadge = (p: string): React.CSSProperties => ({
  fontSize: 13, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
  background: p === 'openai' ? '#ecfdf5' : '#fffbeb', color: p === 'openai' ? '#059669' : '#d97706',
})
const defaultBadge: React.CSSProperties = {
  fontSize: 13, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
  background: '#fefce8', color: '#ca8a04', display: 'inline-flex', alignItems: 'center', gap: 3,
}
const disabledBadge: React.CSSProperties = {
  fontSize: 13, padding: '2px 8px', borderRadius: 5, fontWeight: 500,
  background: 'var(--bg-2)', color: 'var(--text-3)',
}
const modelTag: React.CSSProperties = {
  fontSize: 13, padding: '3px 8px', borderRadius: 5, background: 'var(--bg-2)',
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
const fLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }
const fInput: React.CSSProperties = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
  fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)',
  outline: 'none', width: '100%', boxSizing: 'border-box',
  transition: 'border-color .15s',
}
