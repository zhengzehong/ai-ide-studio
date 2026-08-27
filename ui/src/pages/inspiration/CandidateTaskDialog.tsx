import { Play, Save, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { InspirationCandidate } from '../../stores/inspiration.store'
import type { InspirationConfig } from '../../stores/inspiration.store'
import type { SessionData } from '../../stores/session.store'

export type CandidateAction = 'edit' | 'create' | 'execute'

interface CandidateTaskDialogProps {
  candidate: InspirationCandidate
  action: CandidateAction
  agents: AgentData[]
  sessions: SessionData[]
  config: InspirationConfig | null
  busy: boolean
  onClose: () => void
  onConfirm: (input: { title: string; descriptionMarkdown: string; agentId: string; sessionId: string; action: CandidateAction }) => Promise<void>
}

export function CandidateTaskDialog({ candidate, action, agents, sessions = [], config, busy, onClose, onConfirm }: CandidateTaskDialogProps) {
  const [title, setTitle] = useState(candidate.title)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState(candidate.descriptionMarkdown)
  const initialAgentId = action === 'edit'
    ? candidate.suggestedAgentId ?? ''
    : config?.taskTargetPriority === 'recommended'
      ? candidate.suggestedAgentId ?? config.taskDefaultAgentId ?? agents[0]?.id ?? ''
      : config?.taskDefaultAgentId ?? candidate.suggestedAgentId ?? agents[0]?.id ?? ''
  const [agentId, setAgentId] = useState(initialAgentId)
  const [sessionId, setSessionId] = useState(config?.taskDefaultAgentId === initialAgentId ? config.taskDefaultSessionId ?? '' : '')
  const canConfirm = title.trim().length > 0
    && descriptionMarkdown.trim().length > 0
    && (action === 'edit' || agentId.length > 0)
    && !busy

  return (
    <div className="inspiration-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="inspiration-task-dialog" role="dialog" aria-modal="true" aria-labelledby="candidate-dialog-title">
        <header>
          <div><h2 id="candidate-dialog-title">{dialogTitle(action)}</h2><span>{dialogSubtitle(action)}</span></div>
          <button type="button" className="inspiration-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button>
        </header>
        <div className="inspiration-dialog-body">
          <label><span>任务标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>
          <label><span>任务说明</span><textarea value={descriptionMarkdown} onChange={(event) => setDescriptionMarkdown(event.target.value)} maxLength={20_000} /><small>建议包含背景、目标、范围、交付物和验收标准。</small></label>
          {action !== 'edit' && <label><span>执行 Agent</span><select value={agentId} onChange={(event) => { setAgentId(event.target.value); setSessionId('') }}><option value="">请选择 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
          {action !== 'edit' && <label><span>执行会话</span><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">自动新建会话</option>{sessions.filter((session) => session.agent_id === agentId && session.status === 'active' && !session.deleted_at && !session.archived_at).map((session) => <option key={session.id} value={session.id}>{session.title || session.id}</option>)}</select></label>}
          {candidate.agentReason && <div className="inspiration-agent-reason"><strong>AI 推荐理由</strong>{candidate.agentReason}</div>}
          {action === 'execute' && <div className="inspiration-session-choice"><strong>执行会话</strong><span>默认创建独立任务会话，灵感会话只保留讨论和整理上下文。</span></div>}
        </div>
        <footer>
          <button type="button" className="inspiration-secondary" onClick={onClose}>取消</button>
          <button type="button" className="inspiration-primary" disabled={!canConfirm} onClick={() => void onConfirm({ title: title.trim(), descriptionMarkdown: descriptionMarkdown.trim(), agentId, sessionId, action })}>
            {action === 'execute' ? <Play size={15} /> : <Save size={15} />}{busy ? '处理中…' : confirmLabel(action)}
          </button>
        </footer>
      </section>
    </div>
  )
}

function dialogTitle(action: CandidateAction): string {
  if (action === 'execute') return '执行候选任务'
  if (action === 'create') return '创建候选任务'
  return '编辑候选任务'
}

function dialogSubtitle(action: CandidateAction): string {
  if (action === 'execute') return '确认内容和 Agent 后创建独立会话执行'
  if (action === 'create') return '只进入任务清单，不启动 Agent'
  return '修改只影响当前候选任务'
}

function confirmLabel(action: CandidateAction): string {
  if (action === 'execute') return '创建并执行'
  if (action === 'create') return '只创建任务'
  return '保存修改'
}
