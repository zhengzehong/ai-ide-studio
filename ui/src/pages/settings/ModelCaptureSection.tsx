import { useEffect, useState, type CSSProperties } from 'react'
import { Radio } from 'lucide-react'
import { wsRpc } from '../../services/ws'

interface CaptureSettingsData {
  enabled: boolean
  retentionDays: number
}

export function ModelCaptureSection() {
  const [settings, setSettings] = useState<CaptureSettingsData>({ enabled: false, retentionDays: 7 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void wsRpc('modelCapture.get')
      .then((data) => setSettings(data as CaptureSettingsData))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : '读取失败'))
      .finally(() => setLoading(false))
  }, [])

  const save = async (patch: Partial<CaptureSettingsData>) => {
    setSaving(true)
    setMessage(null)
    try {
      const next = await wsRpc('modelCapture.set', patch) as CaptureSettingsData
      setSettings(next)
      setMessage('已保存,下一次对话生效(现有 Agent 进程将自动重启切换)')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section style={section}>
      <div style={header}>
        <div>
          <h2 style={title}><Radio size={18} color="var(--blue)" /> 模型代理抓包</h2>
          <p style={hint}>
            开启后 Agent 模型流量经本地代理转发并完整落盘(请求体+流式响应),用于事后复现排查;
            落盘目录 data/captures,按保留天数自动清理。关闭后下一次对话自动切回直连。
          </p>
        </div>
      </div>
      <div style={row}>
        <span style={rowLabel}>启用抓包</span>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void save({ enabled: !settings.enabled })}
          style={{
            ...toggleButton,
            ...(settings.enabled ? toggleOn : {}),
          }}
        >
          {settings.enabled ? '已开启' : '已关闭'}
        </button>
      </div>
      <div style={row}>
        <span style={rowLabel}>保留天数</span>
        <input
          type="number"
          min={1}
          max={365}
          disabled={loading || saving}
          value={settings.retentionDays}
          onChange={(event) => setSettings((prev) => ({ ...prev, retentionDays: Number(event.target.value) }))}
          style={numberInput}
        />
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => void save({ retentionDays: settings.retentionDays })}
          style={saveButton}
        >
          保存
        </button>
      </div>
      {message && <div style={messageStyle}>{message}</div>}
    </section>
  )
}

const section: CSSProperties = {
  marginBottom: 32, padding: '18px 20px', borderRadius: 12,
  border: '1px solid var(--border)', background: 'var(--bg-1)',
}
const header: CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }
const title: CSSProperties = { fontSize: 16, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }
const hint: CSSProperties = { fontSize: 13, color: 'var(--text-3)', margin: '6px 0 0', lineHeight: 1.6 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }
const rowLabel: CSSProperties = { fontSize: 14, width: 72 }
const toggleButton: CSSProperties = {
  padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-2)', cursor: 'pointer', fontSize: 13,
}
const toggleOn: CSSProperties = { background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' }
const numberInput: CSSProperties = {
  width: 90, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-2)', fontSize: 13,
}
const saveButton: CSSProperties = {
  padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-2)', cursor: 'pointer', fontSize: 13,
}
const messageStyle: CSSProperties = { marginTop: 10, fontSize: 13, color: 'var(--text-3)' }
