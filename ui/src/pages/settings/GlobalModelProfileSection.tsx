import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CheckCircle2, Globe2, RotateCcw } from 'lucide-react'
import { useModelStore, type ModelProfileData } from '../../stores/model.store'

type Runtime = 'claude' | 'codex'

const runtimeLabels: Record<Runtime, string> = { claude: 'Claude Code', codex: 'Codex' }

export function GlobalModelProfileSection() {
  const profiles = useModelStore((state) => state.profiles)
  const globalProfiles = useModelStore((state) => state.globalProfiles)
  const fetchGlobalProfiles = useModelStore((state) => state.fetchGlobalProfiles)
  const setGlobalProfile = useModelStore((state) => state.setGlobalProfile)
  const clearGlobalProfile = useModelStore((state) => state.clearGlobalProfile)
  const bulkSetMode = useModelStore((state) => state.bulkSetAgentModelProfileMode)
  const [drafts, setDrafts] = useState<Partial<Record<Runtime, string>>>({})
  const [saving, setSaving] = useState<Runtime | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void fetchGlobalProfiles().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '全局档案读取失败')
    })
  }, [fetchGlobalProfiles])

  const profilesByRuntime = useMemo(() => ({
    claude: profiles.filter((profile) => profile.enabled && profile.runtime === 'claude'),
    codex: profiles.filter((profile) => profile.enabled && profile.runtime === 'codex'),
  }), [profiles])

  const apply = async (runtime: Runtime) => {
    setSaving(runtime)
    setMessage(null)
    try {
      const profileId = drafts[runtime] !== undefined
        ? drafts[runtime]
        : globalProfiles[runtime].enabled
          ? globalProfiles[runtime].profileId
          : undefined
      if (profileId) await setGlobalProfile(runtime, profileId)
      else await clearGlobalProfile(runtime)
      setDrafts((draft) => ({ ...draft, [runtime]: undefined }))
      setMessage(`${runtimeLabels[runtime]} 全局档案已更新，下一轮请求生效`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '全局档案更新失败')
    } finally {
      setSaving(null)
    }
  }

  const setAllMode = async (runtime: Runtime, mode: 'global' | 'system') => {
    const action = mode === 'global' ? '跟随全局档案' : '使用系统配置'
    if (!window.confirm(`确认让全部 ${runtimeLabels[runtime]} Agent ${action}？`)) return
    setSaving(runtime)
    setMessage(null)
    try {
      const count = await bulkSetMode(runtime, mode)
      setMessage(`已更新 ${count} 个 ${runtimeLabels[runtime]} Agent，下一轮请求生效`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Agent 策略更新失败')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section style={section}>
      <div style={header}>
        <div>
          <h2 style={title}><Globe2 size={18} color="var(--blue)" /> 全局模型档案</h2>
          <p style={hint}>跟随全局且没有单独 Session 模型偏好的 Agent，会在下一轮请求使用这里的连接、Key 和模型配置</p>
        </div>
      </div>
      <div style={runtimeGrid}>
        {(['claude', 'codex'] as Runtime[]).map((runtime) => {
          const current = globalProfiles[runtime]
          const options = profilesByRuntime[runtime]
          const value = drafts[runtime] !== undefined
            ? drafts[runtime] ?? ''
            : current.enabled ? current.profileId ?? '' : ''
          const profile = options.find((item) => item.id === value)
          return (
            <div key={runtime} style={runtimeCard}>
              <div style={runtimeTitle}>{runtimeLabels[runtime]}</div>
              <select
                value={value}
                onChange={(event) => setDrafts((draft) => ({ ...draft, [runtime]: event.target.value }))}
                style={input}
              >
                <option value="">不启用全局档案</option>
                {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <div style={currentText}>
                {current.enabled && current.profile
                  ? `当前：${current.profile.name}`
                  : '当前：使用 Agent 或系统配置'}
              </div>
              {profile && <div style={profileText}>{profileSummary(profile)}</div>}
              <div style={actions}>
                <button type="button" onClick={() => void apply(runtime)} disabled={saving !== null} style={primaryButton}>
                  <CheckCircle2 size={14} /> 应用
                </button>
                <button type="button" onClick={() => void setAllMode(runtime, 'global')} disabled={saving !== null} style={secondaryButton}>
                  <Globe2 size={14} /> 全部跟随
                </button>
                <button type="button" onClick={() => void setAllMode(runtime, 'system')} disabled={saving !== null} style={secondaryButton} title="让全部 Agent 暂时绕过全局档案">
                  <RotateCcw size={14} /> 全部恢复系统
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {message && <div style={messageStyle}>{message}</div>}
    </section>
  )
}

function profileSummary(profile: ModelProfileData): string {
  try {
    const config = JSON.parse(profile.config_json) as { model?: unknown; defaultModel?: unknown }
    const model = typeof config.model === 'string' ? config.model : typeof config.defaultModel === 'string' ? config.defaultModel : ''
    return model ? `模型：${model}` : '模型配置已保存'
  } catch {
    return '模型配置已保存'
  }
}

const section: CSSProperties = { marginBottom: 32, padding: 20, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-1)' }
const header: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }
const title: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 16, fontWeight: 700 }
const hint: CSSProperties = { margin: '5px 0 0', fontSize: 13, color: 'var(--text-3)' }
const runtimeGrid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }
const runtimeCard: CSSProperties = { padding: 14, borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-0)' }
const runtimeTitle: CSSProperties = { marginBottom: 8, fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }
const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14 }
const currentText: CSSProperties = { marginTop: 8, fontSize: 12, color: 'var(--text-2)' }
const profileText: CSSProperties = { marginTop: 4, fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono, monospace)' }
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }
const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', border: 'none', borderRadius: 6, background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }
const secondaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-1)', color: 'var(--text-2)', cursor: 'pointer', fontSize: 12 }
const messageStyle: CSSProperties = { marginTop: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-2)', color: 'var(--text-2)', fontSize: 13 }
