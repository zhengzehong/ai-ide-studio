import { useState, type CSSProperties } from 'react'
import { Copy, Check, X } from 'lucide-react'
import { ModalOverlay } from '../../components/ModalDialog'
import { useShareStore } from '../../stores/share.store'
import type { SharePermission, ShareToolCallVisibility } from '../../services/share-api'

interface ShareModalProps {
  open: boolean
  onClose: () => void
  sessionId: string
  sessionTitle: string
  ownerAgentId: string
  agentName: string
}

type DurationKey = '1h' | '1d' | '7d' | 'never'

const DURATIONS: { key: DurationKey; label: string; ms: number | null }[] = [
  { key: '1h', label: '1 小时', ms: 60 * 60 * 1000 },
  { key: '1d', label: '1 天', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'never', label: '永久', ms: null },
]

function createInitialState(sessionTitle: string) {
  return {
    shareName: sessionTitle,
    agentIntro: '',
    duration: '1d' as DurationKey,
    permission: 'chat' as SharePermission,
    visibility: 'collapse' as ShareToolCallVisibility,
    generatedUrl: null as string | null,
    copied: false,
  }
}

export function ShareModal({ open, onClose, sessionId, sessionTitle, ownerAgentId, agentName }: ShareModalProps) {
  const createShare = useShareStore((s) => s.createShare)
  const loading = useShareStore((s) => s.loading)
  const error = useShareStore((s) => s.error)
  const [state, setState] = useState(() => createInitialState(sessionTitle))

  if (!open) return null

  const update = (patch: Partial<ReturnType<typeof createInitialState>>) => setState((prev) => ({ ...prev, ...patch }))
  const reset = () => setState(createInitialState(sessionTitle))

  const handleClose = () => {
    reset()
    onClose()
  }

  const canSubmit = !!state.shareName.trim() && !!state.agentIntro.trim() && !loading

  const handleSubmit = async () => {
    if (!canSubmit) return
    const durationOpt = DURATIONS.find((d) => d.key === state.duration)!
    const expiresAt = durationOpt.ms == null ? null : new Date(Date.now() + durationOpt.ms).toISOString()
    const share = await createShare({
      sessionId,
      ownerAgentId,
      shareName: state.shareName.trim(),
      agentIntro: state.agentIntro.trim(),
      permission: state.permission,
      toolCallVisibility: state.visibility,
      expiresAt,
    })
    if (share) {
      update({ generatedUrl: `${window.location.origin}/share/${share.share_token}` })
    }
  }

  const handleCopy = async () => {
    if (!state.generatedUrl) return
    try {
      await navigator.clipboard.writeText(state.generatedUrl)
      update({ copied: true })
      setTimeout(() => update({ copied: false }), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <ModalOverlay open={open} onClose={handleClose} title="分享会话" width={480}>
      <div style={styles.body}>
        <Field label="分享名字">
          <input
            value={state.shareName}
            onChange={(e) => update({ shareName: e.target.value })}
            placeholder="访客看到的标题"
            style={styles.input}
          />
        </Field>

        <Field label="Agent 介绍" required>
          <textarea
            value={state.agentIntro}
            onChange={(e) => update({ agentIntro: e.target.value })}
            placeholder={`我是 ${agentName},能帮你 ...`}
            rows={3}
            style={styles.textarea}
          />
        </Field>

        <Field label="有效期">
          <div style={styles.chipRow}>
            {DURATIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => update({ duration: d.key })}
                style={{
                  ...styles.chip,
                  background: state.duration === d.key ? 'var(--blue)' : 'var(--bg-1)',
                  color: state.duration === d.key ? 'white' : 'var(--text-2)',
                  border: `1px solid ${state.duration === d.key ? 'var(--blue)' : 'var(--border)'}`,
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="访客权限">
          <div style={styles.cardRow}>
            <PermissionCard
              active={state.permission === 'chat'}
              label="可对话"
              description="访客可以发消息给 Agent"
              onClick={() => update({ permission: 'chat' })}
            />
            <PermissionCard
              active={state.permission === 'readonly'}
              label="只读"
              description="访客只能看历史和实时进展"
              onClick={() => update({ permission: 'readonly' })}
            />
          </div>
        </Field>

        <Field label="工具调用展示">
          <div style={styles.chipRow}>
            {(['hide', 'collapse', 'expand'] as ShareToolCallVisibility[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => update({ visibility: v })}
                style={{
                  ...styles.chip,
                  background: state.visibility === v ? 'var(--blue)' : 'var(--bg-1)',
                  color: state.visibility === v ? 'white' : 'var(--text-2)',
                  border: `1px solid ${state.visibility === v ? 'var(--blue)' : 'var(--border)'}`,
                }}
              >
                {v === 'hide' ? '不显示' : v === 'collapse' ? '折叠' : '展开'}
              </button>
            ))}
          </div>
        </Field>

        {error && <div style={styles.error}>{error}</div>}

        {state.generatedUrl ? (
          <div style={styles.resultBox}>
            <div style={styles.resultLabel}>分享链接已生成</div>
            <div style={styles.urlRow}>
              <input value={state.generatedUrl} readOnly style={styles.urlInput} />
              <button type="button" onClick={handleCopy} style={styles.copyBtn}>
                {state.copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制</>}
              </button>
            </div>
            <div style={styles.resultHint}>访客打开链接即可看到对话并(按权限)发消息</div>
          </div>
        ) : (
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{
            ...styles.submitBtn,
            background: canSubmit ? 'var(--blue)' : 'var(--bg-3)',
            cursor: canSubmit ? 'pointer' : 'default',
          }}>
            {loading ? '生成中...' : '生成分享链接'}
          </button>
        )}

        <div style={styles.footer}>
          <button type="button" onClick={handleClose} style={styles.closeBtn}>
            <X size={13} /> 关闭
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={styles.field}>
      <label style={styles.label}>
        {label} {required && <span style={{ color: 'var(--red)' }}>*</span>}
      </label>
      {children}
    </div>
  )
}

function PermissionCard({ active, label, description, onClick }: { active: boolean; label: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.permCard,
        border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
        background: active ? 'var(--blue-light)' : 'var(--bg-0)',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: active ? 'var(--blue)' : 'var(--text-1)' }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{description}</div>
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  body: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: 'var(--text-2)' },
  input: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14, outline: 'none' },
  textarea: { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  chipRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  chip: { padding: '5px 12px', borderRadius: 14, fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  cardRow: { display: 'flex', gap: 8 },
  permCard: { flex: 1, padding: 10, borderRadius: 8, cursor: 'pointer', textAlign: 'left' },
  submitBtn: { width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', color: 'white', fontSize: 14, fontWeight: 600 },
  error: { padding: '8px 10px', borderRadius: 6, background: 'var(--red-light, #fef2f2)', color: 'var(--red)', fontSize: 13 },
  resultBox: { padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-1)' },
  resultLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 },
  urlRow: { display: 'flex', gap: 6 },
  urlInput: { flex: 1, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 12, outline: 'none' },
  copyBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
  resultHint: { fontSize: 11, color: 'var(--text-3)', marginTop: 8 },
  footer: { display: 'flex', justifyContent: 'flex-end', marginTop: 4 },
  closeBtn: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' },
}
