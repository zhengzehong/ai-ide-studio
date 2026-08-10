import { useMemo, useState, type CSSProperties } from 'react'
import type {
  ClaudeProfileConfig,
  CodexProfileConfig,
  ModelProfileConfig,
  ModelProfileData,
  ModelProviderData,
} from '../../stores/model.store'
import {
  compatibleProviders,
  parseProfileConfig,
  providerModelIds,
  type ModelProfileRuntime,
} from './model-profile-options'

interface ModelProfileFormProps {
  profile: ModelProfileData | null
  providers: ModelProviderData[]
  onClose: () => void
  onCreate: (profile: {
    name: string
    runtime: ModelProfileRuntime
    providerId: string
    contextWindow?: number | null
    config: ModelProfileConfig
  }) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}

export function ModelProfileForm({ profile, providers, onClose, onCreate, onUpdate }: ModelProfileFormProps) {
  const isEdit = profile !== null
  const initialConfig = profile ? parseProfileConfig(profile) : {}
  const [name, setName] = useState(profile?.name ?? '')
  const [runtime, setRuntime] = useState<ModelProfileRuntime>(profile?.runtime ?? 'claude')
  const initialProviders = compatibleProviders(providers, profile?.runtime ?? 'claude')
  const [providerId, setProviderId] = useState(profile?.provider_id ?? initialProviders[0]?.id ?? '')
  const [contextWindow, setContextWindow] = useState(profile?.context_window ? String(profile.context_window) : '')
  const [defaultModel, setDefaultModel] = useState((initialConfig as ClaudeProfileConfig).defaultModel ?? '')
  const [haikuModel, setHaikuModel] = useState((initialConfig as ClaudeProfileConfig).haikuModel ?? '')
  const [sonnetModel, setSonnetModel] = useState((initialConfig as ClaudeProfileConfig).sonnetModel ?? '')
  const [opusModel, setOpusModel] = useState((initialConfig as ClaudeProfileConfig).opusModel ?? '')
  const [allowImageRead, setAllowImageRead] = useState((initialConfig as ClaudeProfileConfig).allowImageRead === true)
  const [codexModel, setCodexModel] = useState((initialConfig as CodexProfileConfig).model ?? '')
  const [effort, setEffort] = useState((initialConfig as CodexProfileConfig).effort ?? '')
  const visibleProviders = useMemo(() => compatibleProviders(providers, runtime), [providers, runtime])
  const selectedProvider = visibleProviders.find((provider) => provider.id === providerId)
  const modelIds = providerModelIds(selectedProvider)

  const changeRuntime = (next: ModelProfileRuntime) => {
    setRuntime(next)
    const nextProviders = compatibleProviders(providers, next)
    if (!nextProviders.some((provider) => provider.id === providerId)) setProviderId(nextProviders[0]?.id ?? '')
    if (!isEdit) {
      setDefaultModel('')
      setHaikuModel('')
      setSonnetModel('')
      setOpusModel('')
      setAllowImageRead(false)
      setCodexModel('')
      setEffort('')
    }
  }

  const submit = async () => {
    if (!name.trim() || !providerId) return
    const context = contextWindow.trim() ? Number(contextWindow) : null
    if (context !== null && (!Number.isSafeInteger(context) || context <= 0)) return
    const config: ModelProfileConfig = runtime === 'claude'
      ? {
        defaultModel: defaultModel.trim(),
        haikuModel: haikuModel.trim() || undefined,
        sonnetModel: sonnetModel.trim() || undefined,
        opusModel: opusModel.trim() || undefined,
        allowImageRead,
      }
      : { model: codexModel.trim(), effort: effort || undefined }
    if (runtime === 'claude' && !(config as ClaudeProfileConfig).defaultModel) return
    if (runtime === 'codex' && !(config as CodexProfileConfig).model) return
    const fields = { name: name.trim(), runtime, providerId, contextWindow: context, config }
    if (profile) await onUpdate(profile.id, fields)
    else await onCreate(fields)
    onClose()
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(event) => event.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>
          {isEdit ? '编辑模型档案' : '新建模型档案'}
        </h2>
        <div style={grid}>
          <Field label="档案名称"><input value={name} onChange={(event) => setName(event.target.value)} style={input} /></Field>
          <Field label="运行时">
            <select value={runtime} onChange={(event) => changeRuntime(event.target.value as ModelProfileRuntime)} style={input}>
              <option value="claude">Claude Code</option><option value="codex">Codex</option>
            </select>
          </Field>
        </div>
        <div style={grid}>
          <Field label="模型连接">
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)} style={input}>
              <option value="">选择连接</option>
              {visibleProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.display_name}</option>)}
            </select>
          </Field>
          <Field label="模型上下文">
            <input value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} style={input} inputMode="numeric" placeholder="留空继承系统默认" />
          </Field>
        </div>
        {runtime === 'claude' ? (
          <>
            <ModelField label="默认模型" value={defaultModel} onChange={setDefaultModel} models={modelIds} listId="claude-default-models" required />
            <div style={grid}>
              <ModelField label="Haiku 轻量模型" value={haikuModel} onChange={setHaikuModel} models={modelIds} listId="claude-haiku-models" />
              <ModelField label="Sonnet 主力模型" value={sonnetModel} onChange={setSonnetModel} models={modelIds} listId="claude-sonnet-models" />
            </div>
            <ModelField label="Opus 强力模型" value={opusModel} onChange={setOpusModel} models={modelIds} listId="claude-opus-models" />
            <label style={{ ...label, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
              <input type="checkbox" checked={allowImageRead} onChange={(event) => setAllowImageRead(event.target.checked)} />
              允许 Agent 主动读取图片
            </label>
          </>
        ) : (
          <div style={grid}>
            <ModelField label="默认模型" value={codexModel} onChange={setCodexModel} models={modelIds} listId="codex-models" required />
            <Field label="推理强度">
              <select value={effort} onChange={(event) => setEffort(event.target.value)} style={input}>
                <option value="">继承系统默认</option><option value="none">none</option><option value="low">low</option>
                <option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option>
              </select>
            </Field>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={ghostButton}>取消</button>
          <button onClick={submit} style={primaryButton}>{isEdit ? '保存修改' : '创建档案'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return <label style={label}>{text}{children}</label>
}

function ModelField(props: { label: string; value: string; models: string[]; listId: string; required?: boolean; onChange: (value: string) => void }) {
  return (
    <Field label={props.label}>
      <input list={props.listId} value={props.value} onChange={(event) => props.onChange(event.target.value)} style={input} placeholder={props.required ? '选择或输入模型 ID' : '留空继承系统默认'} />
      <datalist id={props.listId}>{props.models.map((model) => <option key={model} value={model} />)}</datalist>
    </Field>
  )
}

const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600 }
const ghostButton: CSSProperties = { ...primaryButton, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' }
const overlay: CSSProperties = { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }
const modalBox: CSSProperties = { width: 'min(640px, 100%)', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg-1)', borderRadius: 14, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }
const label: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12, fontSize: 15, fontWeight: 600, color: 'var(--text-2)' }
const input: CSSProperties = { padding: '9px 11px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 15, outline: 'none', width: '100%', boxSizing: 'border-box' }
