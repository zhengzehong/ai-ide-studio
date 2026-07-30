import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MonitorCog, RotateCcw, Server, Wifi } from 'lucide-react'
import {
  getElectronDesktopBridge,
  type DesktopConnectionInput,
  type DesktopConnectionMode,
  type DesktopConnectionSettings,
} from '../../services/electron-desktop'

type OperationState = 'idle' | 'testing' | 'saving'

export function DesktopConnectionSection() {
  const bridge = getElectronDesktopBridge()
  const [settings, setSettings] = useState<DesktopConnectionSettings | null>(null)
  const [mode, setMode] = useState<DesktopConnectionMode>('managed-local')
  const [origin, setOrigin] = useState('')
  const [token, setToken] = useState('')
  const [widgetEnabled, setWidgetEnabled] = useState(true)
  const [operation, setOperation] = useState<OperationState>('idle')
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!bridge) return
    let active = true
    void bridge.getSettings().then((value) => {
      if (!active) return
      setSettings(value)
      setMode(value.mode)
      setOrigin(value.remoteOrigin)
      setWidgetEnabled(value.widgetEnabled)
    }).catch((error: unknown) => {
      if (active) setFeedback({ ok: false, message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [bridge])

  if (!bridge) return null

  const input = (): DesktopConnectionInput => ({
    mode,
    remoteOrigin: origin,
    token,
    widgetEnabled,
  })

  const testConnection = async (): Promise<void> => {
    setOperation('testing')
    setFeedback(null)
    const result = await bridge.testConnection(input())
    setOperation('idle')
    setFeedback(result.ok
      ? { ok: true, message: mode === 'remote' ? '连接成功' : '本机模式配置有效' }
      : { ok: false, message: result.error ?? '连接失败' })
  }

  const saveAndRestart = async (): Promise<void> => {
    setOperation('saving')
    setFeedback(null)
    const result = await bridge.saveSettings(input())
    if (!result.ok) {
      setOperation('idle')
      setFeedback({ ok: false, message: result.error ?? '保存失败' })
      return
    }
    setFeedback({ ok: true, message: '正在重启桌面端...' })
  }

  return (
    <section style={sectionStyle} aria-labelledby="desktop-connection-heading">
      <div style={sectionHeaderStyle}>
        <div>
          <h2 id="desktop-connection-heading" style={headingStyle}>
            <MonitorCog size={18} color="var(--blue)" /> 桌面连接
          </h2>
          <div style={statusStyle}>
            <span style={statusDotStyle} />
            {settings?.mode === 'remote' ? settings.remoteOrigin : '本机一体化'}
          </div>
        </div>
      </div>

      <div style={modeGridStyle}>
        <ModeButton
          active={mode === 'managed-local'}
          icon={<MonitorCog size={18} />}
          label="本机一体化"
          onClick={() => setMode('managed-local')}
        />
        <ModeButton
          active={mode === 'remote'}
          icon={<Server size={18} />}
          label="远程服务器"
          onClick={() => setMode('remote')}
        />
      </div>

      {mode === 'remote' && (
        <div style={fieldGridStyle}>
          <label style={labelStyle}>
            服务器地址
            <input
              value={origin}
              onChange={(event) => setOrigin(event.target.value)}
              placeholder="https://ide.example.com"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            访问密钥
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={settings?.hasStoredToken ? '已保存，留空保持不变' : '输入访问密钥'}
              autoComplete="off"
              style={inputStyle}
            />
          </label>
        </div>
      )}

      <label style={widgetStyle}>
        <input
          type="checkbox"
          checked={widgetEnabled}
          onChange={(event) => setWidgetEnabled(event.target.checked)}
        />
        <span>启用桌面 Widget</span>
      </label>

      {feedback && (
        <div role="status" style={{ ...feedbackStyle, color: feedback.ok ? 'var(--green)' : 'var(--red)' }}>
          {feedback.ok ? <CheckCircle2 size={15} /> : null}
          {feedback.message}
        </div>
      )}

      <div style={actionsStyle}>
        <button type="button" style={secondaryButtonStyle} disabled={operation !== 'idle'} onClick={() => { void testConnection() }}>
          {operation === 'testing' ? <Loader2 size={15} className="spin" /> : <Wifi size={15} />}
          测试连接
        </button>
        <button type="button" style={primaryButtonStyle} disabled={operation !== 'idle'} onClick={() => { void saveAndRestart() }}>
          {operation === 'saving' ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />}
          保存并重启
        </button>
      </div>
    </section>
  )
}

function ModeButton(props: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      style={{ ...modeButtonStyle, borderColor: props.active ? 'var(--blue)' : 'var(--border)', color: props.active ? 'var(--blue)' : 'var(--text-2)' }}
    >
      {props.icon}{props.label}
    </button>
  )
}

const sectionStyle: React.CSSProperties = { marginBottom: 32, borderBottom: '1px solid var(--border)', paddingBottom: 28 }
const sectionHeaderStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', marginBottom: 16 }
const headingStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 16 }
const statusStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, color: 'var(--text-3)', fontSize: 13 }
const statusDotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }
const modeGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
const modeButtonStyle: React.CSSProperties = { height: 44, border: '1px solid', borderRadius: 6, background: 'var(--bg-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', fontWeight: 600 }
const fieldGridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 16 }
const labelStyle: React.CSSProperties = { display: 'grid', gap: 6, fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }
const inputStyle: React.CSSProperties = { width: '100%', height: 40, border: '1px solid var(--border)', borderRadius: 6, padding: '0 11px', background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 14 }
const widgetStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, marginTop: 17, fontSize: 14, color: 'var(--text-2)' }
const feedbackStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 13, fontSize: 13 }
const actionsStyle: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }
const secondaryButtonStyle: React.CSSProperties = { height: 36, padding: '0 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }
const primaryButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, border: 0, background: 'var(--blue)', color: '#fff', fontWeight: 600 }
