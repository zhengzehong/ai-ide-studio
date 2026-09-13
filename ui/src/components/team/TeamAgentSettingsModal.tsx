import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import { Cpu, X } from 'lucide-react'
import type { ModelProfileData } from '../../stores/model.store'
import type { TeamDockMember, TeamMemberModelConfig } from './TeamAgentDock'

type TeamModelProfileMode = 'inherit' | 'fixed' | 'system'

interface TeamAgentSettingsModalProps {
  member: TeamDockMember
  config: TeamMemberModelConfig
  /** Master 当前生效模型，用于「继承 Master」的生效预览。 */
  masterEffective: { name: string; source: string } | null
  modelProfiles: ModelProfileData[]
  onLoadProfiles: () => void
  onSave: (input: { modelProfileMode: TeamModelProfileMode; modelProfileId: string | null; systemPromptOverride: string | null }) => Promise<void>
  onRemoveRequest: () => void
  onClose: () => void
}

/** 团队版 Agent 设置弹窗：只含模型策略/模型档案/系统提示词；视觉规范复刻 AgentSettingsModal（不改动其代码）。 */
export function TeamAgentSettingsModal({ member, config, masterEffective, modelProfiles, onLoadProfiles, onSave, onRemoveRequest, onClose }: TeamAgentSettingsModalProps): ReactElement {
  const isMaster = member.role === 'leader'
  const [mode, setMode] = useState<TeamModelProfileMode>(config.modelProfileMode)
  const [profileId, setProfileId] = useState(config.modelProfileId ?? '')
  const [prompt, setPrompt] = useState(config.systemPromptOverride ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { onLoadProfiles() }, [onLoadProfiles])

  const availableProfiles = useMemo(
    () => modelProfiles.filter((profile) => profile.enabled && profile.runtime === config.runtime),
    [config.runtime, modelProfiles],
  )
  const selectedProfileId = availableProfiles.some((profile) => profile.id === profileId) ? profileId : ''
  const selectedProfile = availableProfiles.find((profile) => profile.id === selectedProfileId)
  const fixedProfileMissing = mode === 'fixed' && !selectedProfileId

  const effectText = useMemo(() => {
    if (isMaster) {
      return mode === 'fixed' && selectedProfile ? `${selectedProfile.name} · Master 档案` : '系统默认 · Master 未指定档案'
    }
    if (mode === 'inherit') return `${masterEffective?.name || '系统默认'} · 继承 Master`
    if (mode === 'fixed') return `${selectedProfile?.name || '未选择档案'} · 独立配置`
    // system：与 dock 行展示同链（Agent 原配置 → 系统默认），直接用后端下发的 fallback 结果。
    return `${config.fallback?.name || '系统默认'} · ${config.fallback?.source || '未指定档案'}`
  }, [isMaster, mode, masterEffective, selectedProfile, config.fallback])

  const save = (): void => {
    if (saving || fixedProfileMissing) return
    setSaving(true)
    setError(null)
    onSave({
      modelProfileMode: mode,
      modelProfileId: mode === 'fixed' ? selectedProfileId : null,
      systemPromptOverride: prompt.trim() ? prompt : null,
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试')
    }).finally(() => setSaving(false))
  }

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={styles.dialog} role="dialog" aria-label="团队 Agent 设置">
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>Agent 设置</h3>
            <p style={styles.subtitle}>修改「{member.name}」在团队内的模型和系统提示词。</p>
          </div>
          <button onClick={onClose} style={styles.closeBtn}><X size={14} /></button>
        </div>

        <div style={styles.body}>
          <Field label="模型策略">
            <select value={mode} onChange={(event) => { setMode(event.target.value as TeamModelProfileMode); setError(null) }} style={styles.input}>
              {!isMaster && <option value="inherit">继承 Master</option>}
              <option value="fixed">固定模型档案</option>
              <option value="system">使用系统默认</option>
            </select>
          </Field>
          <Field label="模型档案">
            <select
              value={selectedProfileId}
              onChange={(event) => { setProfileId(event.target.value); setError(null) }}
              disabled={mode !== 'fixed'}
              style={{ ...styles.input, ...(mode !== 'fixed' ? styles.inputDisabled : {}) }}
            >
              <option value="">请选择模型档案</option>
              {availableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}{profile.is_default ? '（默认）' : ''}</option>
              ))}
            </select>
          </Field>
          <div style={styles.effectHint}>
            <Cpu size={13} style={{ color: 'var(--blue)', flexShrink: 0 }} />
            <span>当前生效：<b style={{ fontWeight: 700 }}>{effectText}</b></span>
          </div>
          <Field label="当前提示词（Agent 原值）">
            <div style={styles.promptPreview}>{config.agentSystemPrompt || '（该 Agent 未设置系统提示词）'}</div>
          </Field>
          <Field label="系统提示词">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="留空则使用该 Agent 当前提示词；填写后仅在本团队内替换（下一轮生效）"
              style={styles.textarea}
            />
          </Field>
          <div style={styles.fieldNote}>配置仅对当前团队生效，不修改项目里的全局 Agent；保存后从下一轮对话生效，不打断当前执行。</div>
          {fixedProfileMissing && <div style={styles.error}>固定模型档案策略需要选择一个可用档案</div>}
          {error && <div style={styles.error}>{error}</div>}
        </div>

        <div style={styles.footer}>
          {!isMaster && (
            <span style={styles.removeWrap}>
              <button onClick={onRemoveRequest} style={styles.removeBtn}>移除成员</button>
            </span>
          )}
          <button onClick={onClose} style={styles.cancelBtn}>取消</button>
          <button onClick={save} disabled={saving || fixedProfileMissing} style={{ ...styles.confirmBtn, opacity: saving || fixedProfileMissing ? 0.5 : 1 }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </>
  )
}

/** 移除成员二次确认：移除团队关系，历史消息保留，之后可重新添加。 */
export function TeamMemberRemoveConfirm({ memberName, busy, onCancel, onConfirm }: { memberName: string; busy: boolean; onCancel: () => void; onConfirm: () => void }): ReactElement {
  return (
    <>
      <div onClick={onCancel} style={styles.overlay} />
      <div style={{ ...styles.dialog, width: 380 }} role="dialog" aria-label="移除成员">
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>移除成员</h3>
            <p style={styles.subtitle}>确定从团队中移除「{memberName}」？</p>
          </div>
        </div>
        <div style={styles.confirmBody}>移除后该成员不再参与本团队执行，其历史消息会保留，之后可重新添加。</div>
        <div style={styles.footer}>
          <button onClick={onCancel} style={styles.cancelBtn}>取消</button>
          <button onClick={onConfirm} disabled={busy} style={{ ...styles.dangerBtn, opacity: busy ? 0.5 : 1 }}>{busy ? '移除中...' : '移除'}</button>
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
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-1)' },
  subtitle: { margin: '5px 0 0', fontSize: 14, color: 'var(--text-3)' },
  closeBtn: {
    border: 'none',
    background: 'transparent',
    color: 'var(--text-3)',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 4,
    display: 'flex',
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
    fontFamily: 'inherit',
  },
  inputDisabled: {
    background: 'var(--bg-2)',
    color: 'var(--text-3)',
    cursor: 'not-allowed',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid var(--border)',
    borderRadius: 6,
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    resize: 'vertical',
    minHeight: 96,
    lineHeight: 1.55,
  },
  effectHint: {
    fontSize: 12.5,
    color: 'var(--text-2)',
    background: 'var(--bg-1)',
    border: '1px solid var(--border-light)',
    borderRadius: 6,
    padding: '7px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  promptPreview: {
    maxHeight: 120,
    overflowY: 'auto',
    fontSize: 12.5,
    lineHeight: 1.55,
    color: 'var(--text-2)',
    background: 'var(--bg-2)',
    border: '1px solid var(--border-light)',
    borderRadius: 6,
    padding: '8px 10px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  fieldNote: { fontSize: 12, color: 'var(--text-3)' },
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
    alignItems: 'center',
  },
  removeWrap: { marginRight: 'auto' },
  removeBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 14px',
    fontSize: 14,
    border: '1px solid var(--border)',
    borderColor: 'rgba(220,38,38,0.3)',
    background: 'var(--bg-0)',
    color: 'var(--red)',
    borderRadius: 6,
    cursor: 'pointer',
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
  dangerBtn: {
    padding: '6px 14px',
    fontSize: 14,
    fontWeight: 600,
    border: 'none',
    background: 'var(--red)',
    color: '#fff',
    borderRadius: 6,
    cursor: 'pointer',
  },
  confirmBody: { fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 },
}
