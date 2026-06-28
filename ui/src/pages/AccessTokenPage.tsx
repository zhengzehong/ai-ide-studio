import { useState, type FormEvent } from 'react'
import { KeyRound, LockKeyhole } from 'lucide-react'
import { useConnectionStore } from '../stores/connection.store'

export default function AccessTokenPage() {
  const savedToken = useConnectionStore((s) => s.token)
  const authError = useConnectionStore((s) => s.authError)
  const saveToken = useConnectionStore((s) => s.saveToken)
  const [token, setToken] = useState(savedToken)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    saveToken(token)
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleSubmit} style={styles.panel}>
        <div style={styles.iconWrap}><LockKeyhole size={24} /></div>
        <h1 style={styles.title}>需要访问密钥</h1>
        <p style={styles.description}>后端已启用访问密钥，请输入密钥后继续连接当前工作台。</p>
        <label style={styles.label}>
          <span>访问密钥</span>
          <div style={styles.inputWrap}>
            <KeyRound size={17} color="var(--text-3)" />
            <input
              autoFocus
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              placeholder="输入 AI_IDE_LOCAL_TOKEN"
              style={styles.input}
            />
          </div>
        </label>
        {authError && <div style={styles.error}>{authError}</div>}
        <button type="submit" style={styles.button} disabled={!token.trim()}>连接</button>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--bg-1)',
    padding: 24,
  },
  panel: {
    width: 'min(420px, 100%)',
    padding: 28,
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-0)',
    boxShadow: 'var(--shadow-md)',
  },
  iconWrap: {
    width: 44,
    height: 44,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 8,
    background: 'var(--blue-light)',
    color: 'var(--blue)',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    lineHeight: 1.3,
    margin: 0,
  },
  description: {
    marginTop: 8,
    color: 'var(--text-2)',
    fontSize: 14,
  },
  label: {
    display: 'grid',
    gap: 8,
    marginTop: 22,
    fontSize: 14,
    color: 'var(--text-2)',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    height: 42,
    background: 'var(--bg-0)',
  },
  input: {
    flex: 1,
    border: 0,
    outline: 'none',
    fontSize: 14,
    background: 'transparent',
    color: 'var(--text-1)',
  },
  error: {
    marginTop: 12,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'var(--red-light)',
    color: 'var(--red)',
    fontSize: 13,
  },
  button: {
    width: '100%',
    height: 42,
    marginTop: 18,
    border: 0,
    borderRadius: 8,
    background: 'var(--blue)',
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
}
