import { useEffect, useState, type CSSProperties } from 'react'
import { Check } from 'lucide-react'
import type { AgentItem } from '../stores/app.store'
import type { InspirationCandidate } from '@desktop/stores/inspiration.store'

interface Props {
  open: boolean
  candidate: InspirationCandidate | null
  agents: AgentItem[]
  busy: boolean
  onClose: () => void
  onConfirm: (agentId: string, execute: boolean) => void
}

/** 候选任务 → 创建任务:选 Agent + 是否立即执行 */
export default function CandidateTaskSheet({ open, candidate, agents, busy, onClose, onConfirm }: Props) {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [execute, setExecute] = useState(true)

  // 每次打开重置:预选 AI 推荐的 Agent(若还在列表里),否则第一个
  useEffect(() => {
    if (!open) return
    const suggested = candidate?.suggestedAgentId
    setAgentId(suggested && agents.some((agent) => agent.id === suggested) ? suggested : agents[0]?.id ?? null)
    setExecute(true)
  }, [open, candidate, agents])

  if (!open || !candidate) return null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.sheetCap} />
        <div style={styles.sheetTitle}>创建任务</div>
        <div style={styles.candidateTitle}>{candidate.title}</div>

        <div style={styles.sectionLabel}>执行 Agent</div>
        <div style={styles.agentList}>
          {agents.map((agent) => {
            const selected = agent.id === agentId
            return (
              <button
                key={agent.id}
                className="pressable"
                style={{ ...styles.agentRow, ...(selected ? styles.agentRowActive : {}) }}
                onClick={() => setAgentId(agent.id)}
              >
                <span style={styles.agentName}>{agent.name}</span>
                <span style={styles.agentType}>{agent.type ?? 'Agent'}</span>
                {selected && <Check size={16} color="var(--primary)" />}
              </button>
            )
          })}
          {agents.length === 0 && <div style={styles.agentEmpty}>还没有可用 Agent,先到 PC 端创建</div>}
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
            onClick={() => agentId && onConfirm(agentId, execute)}
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
    maxHeight: '78vh',
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
  sectionLabel: {
    padding: '4px 20px 6px',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: 1,
    flexShrink: 0,
  },
  agentList: {
    overflowY: 'auto',
    padding: '0 12px',
    flexShrink: 1,
    minHeight: 0,
  },
  agentRow: {
    width: '100%',
    minHeight: 46,
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textAlign: 'left',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid transparent',
  },
  agentRowActive: {
    background: 'var(--primary-bg)',
    borderColor: 'var(--primary-light)',
  },
  agentName: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  agentType: {
    fontSize: 11,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  agentEmpty: {
    padding: '20px 10px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
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
