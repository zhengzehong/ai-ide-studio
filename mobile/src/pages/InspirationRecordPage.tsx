import { useCallback, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAppStore } from '../stores/app.store'
import { useInspirationStore } from '../stores/inspiration.store'
import { showToast } from '../utils/toast'

const MAX_LENGTH = 50_000

export default function InspirationRecordPage() {
  const navigate = useNavigate()
  const currentProjectId = useAppStore((state) => state.currentProjectId)
  const saveNote = useInspirationStore((state) => state.saveNote)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = useCallback(async () => {
    const sourceMarkdown = text.trim()
    if (!sourceMarkdown) return
    if (!currentProjectId) {
      showToast('请先选择项目')
      return
    }
    setSaving(true)
    try {
      await saveNote(currentProjectId, sourceMarkdown)
      showToast('已保存,AI 正在后台整理')
      navigate('/inspiration', { replace: true })
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败')
      setSaving(false)
    }
  }, [text, currentProjectId, saveNote, navigate])

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button className="pressable" style={styles.backBtn} onClick={() => navigate(-1)} aria-label="返回">
          <ArrowLeft size={22} color="var(--text-primary)" />
        </button>
        <span style={styles.headerTitle}>记录灵感</span>
        <span style={styles.headerSpacer} />
      </div>

      <textarea
        style={styles.input}
        value={text}
        autoFocus
        maxLength={MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
        placeholder={'只管写,想到什么记什么...\n\n想法、问题、待办、链接都行,AI 会帮你整理成方案。'}
      />

      <div style={styles.footer}>
        <span style={styles.count}>{text.length} / {MAX_LENGTH}</span>
        <button
          className="pressable"
          style={{ ...styles.saveBtn, ...(text.trim() && !saving ? {} : styles.saveBtnDisabled) }}
          disabled={!text.trim() || saving}
          onClick={() => void handleSave()}
        >
          {saving ? '保存中...' : '记录'}
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg-card)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  backBtn: {
    width: 38,
    height: 38,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  headerSpacer: {
    width: 38,
  },
  input: {
    flex: 1,
    minHeight: 0,
    padding: '16px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--text-primary)',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px calc(10px + var(--safe-bottom))',
    borderTop: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  count: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  saveBtn: {
    marginLeft: 'auto',
    height: 44,
    padding: '0 30px',
    borderRadius: 22,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
  },
  saveBtnDisabled: {
    background: 'var(--border)',
    color: 'var(--text-muted)',
    boxShadow: 'none',
  },
}
