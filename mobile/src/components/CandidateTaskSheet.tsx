import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { wsClient } from '@desktop/services/ws-client'
import type { SessionData } from '@desktop/stores/session.store'
import type { InspirationCandidate, InspirationConfig } from '@desktop/stores/inspiration.store'
import type { AgentItem } from '../stores/app.store'

interface Props {
  open: boolean
  candidate: InspirationCandidate | null
  projectId: string | null
  config: InspirationConfig | null
  busy: boolean
  onClose: () => void
  onConfirm: (agentId: string, sessionId: string, execute: boolean) => void
}

function isActiveAgentSession(session: SessionData, agentId: string | null): boolean {
  return session.agent_id === agentId && session.status === 'active' && !session.deleted_at && !session.archived_at
}

/** 候选任务 → 创建任务:选 Agent + 执行会话 + 是否立即执行(对齐 PC CandidateTaskDialog) */
export default function CandidateTaskSheet({ open, candidate, projectId, config, busy, onClose, onConfirm }: Props) {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [sessions, setSessions] = useState<SessionData[] | null>(null)
  const [loadingAgents, setLoadingAgents] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [execute, setExecute] = useState(true)

  // 派生成原始值做依赖:inspiration:update 推送换 candidate/config 对象引用时不应重置已选项
  const suggested = candidate?.suggestedAgentId ?? null
  const configAgentId = config?.taskDefaultAgentId ?? null
  const configSessionId = config?.taskDefaultSessionId ?? null
  const recommendedFirst = config?.taskTargetPriority === 'recommended'

  useEffect(() => {
    if (!open || !projectId) return
    setAgentId(null)
    setSessionId('')
    setExecute(true)
    setLoadError(null)
    let cancelled = false
    const run = async (): Promise<void> => {
      setLoadingAgents(true)
      try {
        const [agentList, sessionList] = await Promise.all([
          wsClient.request({ type: 'agents.list', projectId }) as Promise<AgentItem[]>,
          wsClient.request({ type: 'sessions.list', projectId }).catch(() => null) as Promise<SessionData[] | null>,
        ])
        if (cancelled) return
        const visibleAgents = agentList.filter((agent) => !agent.hidden_at)
        setAgents(visibleAgents)
        setSessions(sessionList)
        // Agent 默认值对齐 PC:recommended 优先 AI 推荐,否则项目默认 Agent 优先
        const preferred = recommendedFirst ? suggested ?? configAgentId : configAgentId ?? suggested
        const initial = visibleAgents.find((agent) => agent.id === preferred) ?? visibleAgents[0] ?? null
        setAgentId(initial?.id ?? null)
        // 会话默认值对齐 PC:项目默认 Agent 命中且默认会话仍活跃时预选
        if (initial && configAgentId === initial.id && configSessionId
          && (sessionList ?? []).some((session) => session.id === configSessionId && isActiveAgentSession(session, initial.id))) {
          setSessionId(configSessionId)
        }
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : '加载失败')
      } finally {
        if (!cancelled) setLoadingAgents(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, projectId, suggested, configAgentId, configSessionId, recommendedFirst, reloadKey])

  const agentSessions = useMemo(
    () => (sessions ?? []).filter((session) => isActiveAgentSession(session, agentId)),
    [sessions, agentId],
  )

  if (!open || !candidate) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.sheetCap} />
        <div style={styles.sheetTitle}>创建任务</div>
        <div style={styles.candidateTitle}>{candidate.title}</div>

        <div style={styles.scrollArea}>
          <div style={styles.sectionLabel}>执行 Agent</div>
          {loadingAgents && (
            <div style={styles.listStatus}>
              <Loader2 size={15} color="var(--text-muted)" className="spin" />
              <span>加载中...</span>
            </div>
          )}
          {!loadingAgents && loadError && (
            <div style={styles.listStatus}>
              <span style={styles.errorText}>{loadError}</span>
              <button className="pressable" style={styles.retryBtn} onClick={() => setReloadKey((key) => key + 1)}>
                重试
              </button>
            </div>
          )}
          {!loadingAgents && !loadError && (
            <div style={styles.optionList}>
              {agents.map((agent) => {
                const selected = agent.id === agentId
                return (
                  <button
                    key={agent.id}
                    className="pressable"
                    style={{ ...styles.optionRow, ...(selected ? styles.optionRowActive : {}) }}
                    disabled={busy}
                    onClick={() => {
                      // 切 Agent 重置会话,对齐 PC 行为
                      setAgentId(agent.id)
                      setSessionId('')
                    }}
                  >
                    <span style={styles.optionName}>{agent.name}</span>
                    <span style={styles.optionMeta}>{agent.type ?? 'Agent'}</span>
                    {selected && <Check size={16} color="var(--primary)" />}
                  </button>
                )
              })}
              {agents.length === 0 && (
                <div style={styles.optionEmpty}>该项目还没有可用 Agent,先到 PC 端创建</div>
              )}
            </div>
          )}

          <div style={styles.sectionLabel}>执行会话</div>
          <div style={styles.optionList}>
            <button
              className="pressable"
              style={{ ...styles.optionRow, ...(sessionId === '' ? styles.optionRowActive : {}) }}
              disabled={busy || !agentId}
              onClick={() => setSessionId('')}
            >
              <span style={styles.optionName}>自动新建会话</span>
              {sessionId === '' && <Check size={16} color="var(--primary)" />}
            </button>
            {agentSessions.map((session) => {
              const selected = session.id === sessionId
              return (
                <button
                  key={session.id}
                  className="pressable"
                  style={{ ...styles.optionRow, ...(selected ? styles.optionRowActive : {}) }}
                  disabled={busy}
                  onClick={() => setSessionId(session.id)}
                >
                  <span style={styles.optionName}>{session.title || session.id}</span>
                  {selected && <Check size={16} color="var(--primary)" />}
                </button>
              )
            })}
            {sessions === null && (
              <div style={styles.optionEmpty}>会话列表加载失败,仍可自动新建会话</div>
            )}
          </div>
        </div>

        <button style={styles.executeRow} onClick={() => setExecute(!execute)}>
          <span style={styles.executeText}>
            <span style={styles.executeTitle}>创建后立即执行</span>
            <span style={styles.executeDesc}>关闭则只创建任务,之后在任务页手动启动</span>
          </span>
          <span aria-pressed={execute} style={{ ...styles.switch, ...(execute ? styles.switchOn : {}) }}>
            <i style={{ ...styles.switchThumb, ...(execute ? styles.switchThumbOn : {}) }} />
          </span>
        </button>

        <div style={styles.footer}>
          <button className="pressable" style={styles.cancelBtn} onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="pressable"
            style={{ ...styles.confirmBtn, ...(!agentId || busy ? styles.confirmBtnDisabled : {}) }}
            disabled={!agentId || busy}
            onClick={() => agentId && onConfirm(agentId, sessionId, execute)}
          >
            {busy ? '创建中...' : execute ? '创建并执行' : '创建任务'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.4)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '82vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
  },
  sheetCap: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'var(--border)',
    margin: '10px auto 0',
    flexShrink: 0,
  },
  sheetTitle: {
    padding: '10px 20px 2px',
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text-primary)',
    flexShrink: 0,
  },
  candidateTitle: {
    padding: '0 20px 10px',
    fontSize: 12,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  scrollArea: {
    overflowY: 'auto',
    flexShrink: 1,
    minHeight: 0,
  },
  sectionLabel: {
    padding: '4px 20px 6px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: 1,
    flexShrink: 0,
  },
  optionList: {
    padding: '0 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  optionRow: {
    width: '100%',
    minHeight: 44,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
  },
  optionRowActive: {
    background: 'var(--primary-bg)',
    borderColor: 'var(--primary-light)',
  },
  optionName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  optionMeta: {
    fontSize: 11,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  optionEmpty: {
    padding: '16px 10px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  listStatus: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '18px 10px',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
  errorText: {
    color: 'var(--error)',
    fontSize: 13,
  },
  retryBtn: {
    padding: '5px 16px',
    borderRadius: 14,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
  },
  executeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '10px 20px 0',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--bg-input)',
    textAlign: 'left',
    flexShrink: 0,
  },
  executeText: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  executeTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  executeDesc: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  switch: {
    width: 38,
    height: 22,
    position: 'relative',
    flexShrink: 0,
    padding: 2,
    border: 0,
    borderRadius: 11,
    background: 'var(--border)',
  },
  switchOn: {
    background: 'var(--primary)',
  },
  switchThumb: {
    width: 18,
    height: 18,
    display: 'block',
    borderRadius: 9,
    background: '#fff',
    transition: 'transform .15s',
  },
  switchThumbOn: {
    transform: 'translateX(16px)',
  },
  footer: {
    display: 'flex',
    gap: 9,
    padding: '12px 20px calc(12px + var(--safe-bottom))',
    flexShrink: 0,
  },
  cancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontWeight: 600,
  },
  confirmBtn: {
    flex: 2,
    height: 42,
    borderRadius: 21,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
  },
  confirmBtnDisabled: {
    background: 'var(--border)',
    color: 'var(--text-muted)',
  },
}
