import type { CSSProperties } from 'react'
import { Settings, Server, Wifi, WifiOff, LogOut, Info } from 'lucide-react'
import { useConnectionStore } from '../stores/connection.store'

export default function SettingsPage() {
  const { serverUrl, token, connected, disconnect } = useConnectionStore()

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Settings size={20} color="var(--primary)" />
        <span style={styles.headerTitle}>设置</span>
      </div>

      <div style={styles.content}>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>服务器连接</div>
          <div style={styles.card}>
            <div style={styles.row}>
              <Server size={16} color="var(--text-secondary)" />
              <span style={styles.label}>地址</span>
              <span style={styles.value}>{serverUrl || '未配置'}</span>
            </div>
            <div style={styles.divider} />
            <div style={styles.row}>
              {connected ? <Wifi size={16} color="var(--success)" /> : <WifiOff size={16} color="var(--error)" />}
              <span style={styles.label}>状态</span>
              <span style={{ ...styles.value, color: connected ? 'var(--success)' : 'var(--error)' }}>
                {connected ? '已连接' : '未连接'}
              </span>
            </div>
            {token && (
              <>
                <div style={styles.divider} />
                <div style={styles.row}>
                  <Info size={16} color="var(--text-secondary)" />
                  <span style={styles.label}>Token</span>
                  <span style={styles.value}>{'•'.repeat(Math.min(token.length, 12))}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>操作</div>
          <div style={styles.card}>
            <button style={styles.dangerRow} onClick={disconnect}>
              <LogOut size={16} color="var(--error)" />
              <span style={{ color: 'var(--error)', fontSize: 14 }}>断开连接</span>
            </button>
          </div>
        </div>

        <div style={styles.version}>
          AI IDE Studio Mobile v0.2.0
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: 8,
    paddingLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border-light)',
    overflow: 'hidden',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '13px 14px',
  },
  label: {
    fontSize: 14,
    color: 'var(--text-primary)',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    fontFamily: 'monospace',
    maxWidth: '60%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
  },
  divider: {
    height: 1,
    background: 'var(--border-light)',
    marginLeft: 40,
  },
  dangerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '13px 14px',
    width: '100%',
    textAlign: 'left',
  },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: 'var(--text-muted)',
    marginTop: 20,
  },
}
