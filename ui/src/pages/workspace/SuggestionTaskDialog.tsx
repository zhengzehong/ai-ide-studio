import { Play, ClipboardList, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { SessionData } from '../../stores/session.store'
import type { AdvisorSuggestion } from '../../stores/advisor.store'

export type SuggestionSubmitAction = 'create' | 'execute'

interface SuggestionTaskDialogProps {
  suggestion: AdvisorSuggestion
  agents: AgentData[]
  sessions: SessionData[]
  busy: boolean
  onClose: () => void
  onConfirm: (input: { title: string; descriptionMarkdown: string; agentId: string; sessionId: string; execute: boolean }) => Promise<void>
}

/** 建议执行弹窗：可改标题/说明/Agent/会话，取消｜只创建任务｜创建并执行（U-13~U-17） */
export function SuggestionTaskDialog({ suggestion, agents, sessions = [], busy, onClose, onConfirm }: SuggestionTaskDialogProps) {
  const suggestedInList = !!suggestion.suggested_agent_id
    && agents.some((agent) => agent.id === suggestion.suggested_agent_id)
  const [title, setTitle] = useState(suggestion.title)
  const [descriptionMarkdown, setDescriptionMarkdown] = useState(suggestion.description_markdown)
  const [agentId, setAgentId] = useState(suggestedInList ? suggestion.suggested_agent_id! : '')
  const [sessionId, setSessionId] = useState('')
  const canConfirm = title.trim().length > 0
    && descriptionMarkdown.trim().length > 0
    && agentId.length > 0
    && !busy

  const submit = (execute: boolean): void => {
    void onConfirm({
      title: title.trim(),
      descriptionMarkdown: descriptionMarkdown.trim(),
      agentId,
      sessionId,
      execute,
    })
  }

  return (
    <div className="advisor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="advisor-dialog" role="dialog" aria-modal="true" aria-labelledby="suggestion-dialog-title">
        <header>
          <div>
            <h2 id="suggestion-dialog-title">查看并执行建议</h2>
            <span>确认内容和 Agent 后派发执行；只创建任务则先进入任务清单</span>
          </div>
          <button type="button" className="advisor-icon-button" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="advisor-dialog-body">
          <label>
            <span>任务标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
          </label>
          <label>
            <span>任务说明</span>
            <textarea
              value={descriptionMarkdown}
              onChange={(event) => setDescriptionMarkdown(event.target.value)}
              maxLength={20_000}
            />
            <small>建议包含背景、目标、范围、交付物和验收标准。</small>
          </label>
          <label>
            <span>执行 Agent</span>
            <select value={agentId} onChange={(event) => { setAgentId(event.target.value); setSessionId('') }}>
              <option value="">请选择 Agent</option>
              {agents.filter((agent) => !agent.hidden_at).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>执行会话</span>
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              <option value="">自动新建会话</option>
              {sessions
                .filter((session) => session.agent_id === agentId && session.status === 'active' && !session.deleted_at && !session.archived_at)
                .map((session) => (
                  <option key={session.id} value={session.id}>{session.title || session.id}</option>
                ))}
            </select>
          </label>
          {suggestion.suggested_agent_id && !suggestedInList && (
            <div className="advisor-agent-fallback-hint">
              参谋推荐的 Agent 不在当前项目 Agent 列表中，请重新选择执行 Agent。
            </div>
          )}
          {suggestion.agent_reason && (
            <div className="advisor-agent-reason-block">
              <strong>AI 推荐理由</strong>
              {suggestion.agent_reason}
            </div>
          )}
        </div>
        <footer>
          <button type="button" className="advisor-button-secondary" onClick={onClose}>取消</button>
          <button
            type="button"
            className="advisor-button-secondary"
            disabled={!canConfirm}
            onClick={() => submit(false)}
          >
            <ClipboardList size={14} />{busy ? '处理中…' : '只创建任务'}
          </button>
          <button
            type="button"
            className="advisor-button-primary"
            disabled={!canConfirm}
            onClick={() => submit(true)}
          >
            <Play size={14} />{busy ? '处理中…' : '创建并执行'}
          </button>
        </footer>
      </section>
    </div>
  )
}
