import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { Loader2, Monitor, RefreshCw, Unplug } from 'lucide-react'
import { getElectronDesktopBridge, type DesktopNodeStatus } from '../../services/electron-desktop'
import { listDevices, updateDevice, type DeviceSummary } from '../../services/device-client'

export function DeviceSection(): ReactElement {
  const bridge = getElectronDesktopBridge()
  const [devices, setDevices] = useState<DeviceSummary[]>([])
  const [local, setLocal] = useState<DesktopNodeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current
    try {
      const [rows, status] = await Promise.all([listDevices(), bridge?.getNodeStatus?.()])
      if (current !== generation.current) return
      setDevices(rows)
      setLocal(status ?? null)
      setError('')
    } catch (err) { if (current === generation.current) setError(err instanceof Error ? err.message : '读取设备失败') }
    finally { if (current === generation.current) setLoading(false) }
  }, [bridge])

  useEffect(() => {
    const initial = setTimeout(() => { void refresh() }, 0)
    const invalidate = (): void => { generation.current++ }
    const timer = setInterval(() => { void refresh() }, 15_000)
    return () => { clearTimeout(initial); clearInterval(timer); invalidate() }
  }, [refresh])

  const perform = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); await refresh() }
    catch (err) { setError(err instanceof Error ? err.message : '设备操作失败') }
    finally { setBusy(false) }
  }

  return <section aria-labelledby="device-heading" style={{ padding: '24px 0', borderBottom: '1px solid var(--border)' }}>
    <div style={rowStyle}>
      <h2 id="device-heading" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, margin: 0 }}><Monitor size={18} /> 远程电脑</h2>
      <button type="button" title="刷新设备" aria-label="刷新设备" style={iconStyle} disabled={busy || loading} onClick={() => { void refresh() }}>
        <RefreshCw size={16} />
      </button>
    </div>
    {local?.supported && <div style={{ ...rowStyle, padding: '14px 0' }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 13 }}>{local.machineName}</strong>
        <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: 12 }}>当前电脑 · {local.online ? '在线' : local.enabled ? '未连接' : '未启用'}</span>
        {local.error && <div role="status" style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{local.error}</div>}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
        <input type="checkbox" checked={local.enabled} disabled={busy} onChange={(event) => {
          const enabled = event.target.checked
          void perform(async () => { setLocal(await bridge!.setNodeEnabled!(enabled)) })
        }} />允许远程访问
      </label>
      {local.deviceId && !devices.some((device) => device.deviceId === local.deviceId) && <button
        type="button" style={iconStyle} title="清除本机配对" aria-label="清除本机配对" disabled={busy}
        onClick={() => { void perform(() => bridge!.unpairNode!()) }}><Unplug size={16} /></button>}
    </div>}
    {error && <div role="alert" style={{ color: 'var(--red)', fontSize: 13, padding: '8px 0' }}>{error}</div>}
    {loading ? <div role="status" style={{ padding: 12 }}><Loader2 size={16} className="spin" /> 正在加载设备</div>
      : devices.length === 0 ? error ? null : <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '16px 0' }}>暂无已配对电脑</div>
      : <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {devices.map((device) => <li key={device.deviceId} style={{ ...rowStyle, minHeight: 56, borderTop: '1px solid var(--border)', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{device.machineName}{device.deviceId === local?.deviceId ? ' · 当前电脑' : ''}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Windows · {device.online ? '在线' : '离线'} · {device.shells.join(' / ')}</div>
          </div>
          <label title="设备授权" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={device.enabled} disabled={busy} onChange={(event) => {
              const enabled = event.target.checked
              void perform(() => device.deviceId === local?.deviceId && bridge?.setNodeEnabled
                ? bridge.setNodeEnabled(enabled) : updateDevice(device.deviceId, { enabled }))
            }} />启用
          </label>
          <button type="button" title="解除配对" aria-label={`解除 ${device.machineName} 配对`} style={iconStyle} disabled={busy} onClick={() => {
            if (!window.confirm(`解除与“${device.machineName}”的配对？`)) return
            void perform(() => device.deviceId === local?.deviceId && bridge?.unpairNode
              ? bridge.unpairNode() : updateDevice(device.deviceId, { action: 'revoke' }))
          }}><Unplug size={16} /></button>
        </li>)}
      </ul>}
  </section>
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }
const iconStyle: CSSProperties = { width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-1)', color: 'var(--text-2)', cursor: 'pointer' }
