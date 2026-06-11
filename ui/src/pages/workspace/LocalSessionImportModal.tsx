import { useCallback, useEffect, useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import {
  useSessionStore,
  type LocalSessionCandidateInfo,
  type SessionData,
} from '../../stores/session.store'
import { LocalSessionImportCandidateButton } from './LocalSessionImportCandidateButton'

function isLocalImportRuntime(runtime: string): runtime is 'codex' | 'claude' {
  return runtime === 'codex' || runtime === 'claude'
}

export function LocalSessionImportModal({
  agent,
  projectId,
  onImported,
  onClose,
}: {
  agent: AgentData
  projectId?: string
  onImported: (session: SessionData) => Promise<void>
  onClose: () => void
}) {
  const listLocalImportCandidates = useSessionStore((s) => s.listLocalImportCandidates)
  const importLocalSession = useSessionStore((s) => s.importLocalSession)
  const [jsonlPath, setJsonlPath] = useState('')
  const [candidates, setCandidates] = useState<LocalSessionCandidateInfo[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<LocalSessionCandidateInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [imported, setImported] = useState(false)

  const loadCandidates = useCallback(async () => {
    if (!isLocalImportRuntime(agent.runtime)) return
    setLoading(true)
    setError(null)
    try {
      const data = await listLocalImportCandidates(agent.id, projectId)
      setCandidates(data)
      setSelectedCandidate((current) => current && data.some((item) => item.path === current.path) ? current : data[0] ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '扫描本地会话失败')
    } finally {
      setLoading(false)
    }
  }, [agent.id, agent.runtime, listLocalImportCandidates, projectId])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadCandidates()
    })
    return () => { cancelled = true }
  }, [loadCandidates])

  const handleImportPath = async () => {
    const path = jsonlPath.trim()
    if (!path || importing || imported) return
    await handleImport({ jsonlPath: path })
  }

  const handleImportCandidate = async () => {
    if (!selectedCandidate || importing || imported) return
    await handleImport({
      externalSessionId: selectedCandidate.sessionId,
      sourcePath: selectedCandidate.path,
      runtime: selectedCandidate.runtime,
      cwd: selectedCandidate.cwd,
      title: selectedCandidate.label,
    })
  }

  const handleImport = async (input: {
    jsonlPath?: string
    externalSessionId?: string
    sourcePath?: string
    runtime?: 'codex' | 'claude'
    cwd?: string
    title?: string
  }) => {
    setImporting(true)
    setError(null)
    setWarning(null)
    try {
      const result = await importLocalSession(agent.id, { projectId, ...input })
      setImported(true)
      if (result.warning) setWarning(`${result.warning}。已创建并选中新会话，请确认后续回复是否应继续写入这个本地会话。`)
      await onImported(result.session)
      if (!result.warning) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入本地会话失败')
    } finally {
      setImporting(false)
    }
  }

  const canImportPath = !!jsonlPath.trim() && !importing && !imported
  const canImportCandidate = !!selectedCandidate && !importing && !imported
  const unsupportedRuntime = !isLocalImportRuntime(agent.runtime)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--bg-0)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1001,
          padding: 24,
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>导入本地会话</h3>
        <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 16 }}>
          {agent.name} · {agent.runtime}
        </div>

        {unsupportedRuntime ? (
          <div style={{ fontSize: 14, color: 'var(--red)', marginBottom: 16 }}>
            仅支持导入 Codex 或 Claude Code 本地会话。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>
                JSONL 文件路径
              </label>
              <input
                value={jsonlPath}
                onChange={(e) => {
                  setJsonlPath(e.target.value)
                  setImported(false)
                  setWarning(null)
                }}
                placeholder="例如: C:\\Users\\me\\.codex\\sessions\\...\\rollout-xxx.jsonl"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 14,
                  background: 'var(--bg-1)',
                  color: 'var(--text-1)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={handleImportPath}
                disabled={!canImportPath}
                style={{
                  marginTop: 8,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--blue)',
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: canImportPath ? 'pointer' : 'not-allowed',
                  opacity: canImportPath ? 1 : 0.5,
                }}
              >
                {importing ? '导入中...' : '按路径导入'}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-2)' }}>本地候选会话</span>
                <button
                  type="button"
                  onClick={() => void loadCandidates()}
                  disabled={loading || importing}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 7,
                    background: 'var(--bg-0)',
                    color: 'var(--text-2)',
                    cursor: loading || importing ? 'not-allowed' : 'pointer',
                    padding: '5px 9px',
                    fontSize: 13,
                    opacity: loading || importing ? 0.6 : 1,
                  }}
                >
                  {loading ? '扫描中...' : '刷新'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                {loading ? (
                  <div style={{ fontSize: 14, color: 'var(--text-3)', padding: '12px 0' }}>正在扫描本地会话...</div>
                ) : candidates.length === 0 ? (
                  <div style={{ fontSize: 14, color: 'var(--text-3)', padding: '12px 0' }}>未扫描到可导入会话</div>
                ) : candidates.map((candidate) => (
                  <LocalSessionImportCandidateButton
                    key={`${candidate.runtime}:${candidate.path}:${candidate.sessionId}`}
                    candidate={candidate}
                    active={selectedCandidate?.path === candidate.path}
                    onSelect={() => {
                      setSelectedCandidate(candidate)
                      setImported(false)
                      setWarning(null)
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleImportCandidate}
                disabled={!canImportCandidate}
                style={{
                  marginTop: 10,
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--blue)',
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: canImportCandidate ? 'pointer' : 'not-allowed',
                  opacity: canImportCandidate ? 1 : 0.5,
                }}
              >
                {importing ? '导入中...' : '导入选中会话'}
              </button>
            </div>
          </div>
        )}

        {warning && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: '#fff7ed', color: '#c2410c', fontSize: 14, lineHeight: 1.5 }}>
            {warning}
          </div>
        )}
        {imported && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: 'var(--blue-light)', color: 'var(--blue)', fontSize: 14 }}>
            已导入并选中新会话。
          </div>
        )}
        {error && (
          <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: '#fef2f2', color: 'var(--red)', fontSize: 14, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-0)',
              color: 'var(--text-2)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {imported ? '关闭' : '取消'}
          </button>
        </div>
      </div>
    </>
  )
}
