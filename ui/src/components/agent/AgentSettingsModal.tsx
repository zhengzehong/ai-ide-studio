import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { AgentData, ProjectAgentInput } from '../../stores/agent.store'
import type { ModelProfileData } from '../../stores/model.store'
import { wsClient } from '../../services/ws-client'
import { AvatarUploader } from './AvatarUploader'
import { TYPE_FILTERS } from '../agent-square/constants'

interface AgentSettingsModalProps {
  agent: AgentData
  modelProfiles: ModelProfileData[]
  onLoadProfiles: () => void
  onSave: (input: Partial<ProjectAgentInput>) => Promise<void>
  onClose: () => void
}

export function AgentSettingsModal({
  agent,
  modelProfiles,
  onLoadProfiles,
  onSave,
  onClose,
}: AgentSettingsModalProps) {
  const [name, setName] = useState(agent.name)
  const [icon, setIcon] = useState(agent.icon ?? 'bot')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(agent.avatar_url ?? null)
  const [pendingDataUrl, setPendingDataUrl] = useState<string | null>(null)
  const [modelProfileId, setModelProfileId] = useState<string>(() => {
    if (!agent.config_json) return ''
    try {
      const config = JSON.parse(agent.config_json) as { modelProfileId?: unknown }
      return typeof config.modelProfileId === 'string' ? config.modelProfileId : ''
    } catch {
      return ''
    }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableProfiles = useMemo(
    () => modelProfiles.filter((p) => p.enabled && p.runtime === agent.runtime),
    [agent.runtime, modelProfiles],
  )

  useEffect(() => { onLoadProfiles() }, [onLoadProfiles])

  const handleSave = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      let finalAvatarUrl: string | null | undefined = avatarUrl
      if (pendingDataUrl) {
        const res = await wsClient.request({
          type: 'assets.upload',
          agentId: agent.id,
          base64: pendingDataUrl,
          ext: 'png',
        }) as { url?: string }
        finalAvatarUrl = res.url ?? null
      } else if (pendingDataUrl === null && avatarUrl === null && agent.avatar_url) {
        finalAvatarUrl = null
      }
      await onSave({
        name: name.trim(),
        icon,
        avatarUrl: finalAvatarUrl,
        modelProfileId: modelProfileId || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={styles.dialog}>
        <div style={styles.header}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>Agent 设置</h3>
            <p style={{ margin: '5px 0 0', fontSize: 14, color: 'var(--text-3)' }}>
              修改「{agent.name}」的头像、名称和模型档案。
            </p>
          </div>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} /></button>
        </div>

        <div style={styles.body}>
          <Field label="头像">
            <AvatarUploader
              currentAvatarUrl={agent.avatar_url}
              currentIcon={icon}
              pendingDataUrl={pendingDataUrl}
              onPendingChange={setPendingDataUrl}
              onChange={(value) => {
                setIcon(value.icon)
                if (value.avatarUrl === null) setAvatarUrl(null)
              }}
            />
          </Field>
          <Field label="名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={styles.input}
              placeholder="Agent 名称"
            />
          </Field>
          <Field label="类型(只读)">
            <input
              value={TYPE_FILTERS.find((t) => t.value === agent.type)?.label ?? agent.type}
              disabled
              style={{ ...styles.input, background: 'var(--bg-2)', color: 'var(--text-3)', cursor: 'not-allowed' }}
            />
          </Field>
          <Field label="运行时(只读)">
            <input
              value={agent.runtime}
              disabled
              style={{ ...styles.input, background: 'var(--bg-2)', color: 'var(--text-3)', cursor: 'not-allowed' }}
            />
          </Field>
          {(agent.runtime === 'claude' || agent.runtime === 'codex') && (
            <Field label="模型档案">
              <select
                value={availableProfiles.some((p) => p.id === modelProfileId) ? modelProfileId : ''}
                onChange={(e) => setModelProfileId(e.target.value)}
                style={styles.input}
              >
                <option value="">不绑定模型档案</option>
                {availableProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}{profile.is_default ? '（默认）' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          <button onClick={onClose} style={styles.cancelBtn}>取消</button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            style={{ ...styles.confirmBtn, opacity: saving || !name.trim() ? 0.5 : 1 }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,0.28)',
    zIndex: 1000,
  },
  dialog: {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    width: 440,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 48px)',
    overflow: 'auto',
    background: 'var(--bg-0)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    zIndex: 1001,
    padding: 22,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    color: 'var(--text-3)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
  },
  body: { display: 'flex', flexDirection: 'column', gap: 14 },
  fieldLabel: {
    display: 'block',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-2)',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    outline: 'none',
    boxSizing: 'border-box',
  },
  error: {
    fontSize: 12,
    color: 'var(--red, #dc2626)',
    padding: '6px 10px',
    background: 'rgba(220,38,38,0.08)',
    borderRadius: 4,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 20,
  },
  cancelBtn: {
    padding: '6px 14px',
    fontSize: 14,
    border: '1px solid var(--border)',
    background: 'var(--bg-1)',
    color: 'var(--text-2)',
    borderRadius: 6,
    cursor: 'pointer',
  },
  confirmBtn: {
    padding: '6px 14px',
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    background: 'var(--blue)',
    color: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
  },
}
