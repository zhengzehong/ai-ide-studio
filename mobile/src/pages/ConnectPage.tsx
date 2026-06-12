import { useState, useEffect, type CSSProperties, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wifi, ArrowRight, Server, Key } from 'lucide-react'
import { useConnectionStore } from '../stores/connection.store'

export default function ConnectPage() {
  const { serverUrl, setServer, connected, status, lastError } = useConnectionStore()
  const navigate = useNavigate()
  const [url, setUrl] = useState(serverUrl || 'http://192.168.')
  const [token, setToken] = useState('')
  const loading = status === 'connecting'

  useEffect(() => {
    if (connected && serverUrl) navigate('/', { replace: true })
  }, [connected, serverUrl, navigate])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setServer(url.trim(), token.trim() || undefined)
  }

  return (
    <div style={styles.page}>
      <div style={styles.iconWrap}>
        <Wifi size={48} color="var(--primary)" strokeWidth={1.5} />
      </div>
      <h1 style={styles.title}>连接服务器</h1>
      <p style={styles.subtitle}>输入 AI IDE Studio 服务器地址</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.inputGroup}>
          <Server size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            style={styles.input}
            placeholder="http://192.168.1.100:18800"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
        </div>
        <div style={styles.inputGroup}>
          <Key size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            style={styles.input}
            placeholder="Token（可选）"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
          />
        </div>
        <button type="submit" style={styles.btn} disabled={loading || !url.trim()}>
          {loading ? '连接中...' : '连接'}
          {!loading && <ArrowRight size={18} />}
        </button>
        {lastError && <div style={styles.error}>{lastError}</div>}
      </form>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '0 32px',
    background: 'var(--bg)',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: '50%',
    background: 'var(--primary-bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    marginBottom: 32,
  },
  form: {
    width: '100%',
    maxWidth: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '0 14px',
    height: 48,
  },
  input: {
    flex: 1,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontSize: 15,
    color: 'var(--text-primary)',
  },
  btn: {
    height: 48,
    borderRadius: 'var(--radius)',
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 16,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  error: {
    fontSize: 13,
    color: 'var(--error)',
    textAlign: 'center',
    minHeight: 20,
  },
}
