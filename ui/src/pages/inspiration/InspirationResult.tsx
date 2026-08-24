import { Bot, CircleAlert, CircleCheck, CircleDashed, ExternalLink, Pencil, Play, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import type { InspirationCandidate, InspirationNote } from '../../stores/inspiration.store'
import type { CandidateAction } from './CandidateTaskDialog'

interface InspirationResultProps {
  note: InspirationNote
  onEdit: () => void
  onRetry: () => void
  onCandidateAction: (candidate: InspirationCandidate, action: CandidateAction) => void
  onOpenTask: (taskId: string) => void
  onOpenSession: (sessionId: string) => void
}

export function InspirationResult({ note, onEdit, onRetry, onCandidateAction, onOpenTask, onOpenSession }: InspirationResultProps) {
  if (note.status === 'queued' || note.status === 'processing') {
    return <ResultState icon={<RefreshCw size={20} className="inspiration-spin" />} title={note.status === 'queued' ? '等待整理' : 'AI 正在整理'} detail="原始记录已经保存。完成后会自动更新摘要、Markdown 方案和候选任务。" />
  }
  if (note.status === 'failed') {
    return <ResultState icon={<CircleAlert size={20} />} title="整理失败" detail={note.lastError || '项目灵感会话没有返回结构化结果。'} action={<button type="button" className="inspiration-primary" onClick={onRetry}><RefreshCw size={14} />重新整理</button>} />
  }
  if (!note.bodyMarkdown) {
    return <ResultState icon={<CircleDashed size={20} />} title="尚未整理" detail="这条灵感已保存。配置整理 Agent 后可以生成方案和候选任务。" action={<button type="button" className="inspiration-secondary" onClick={onEdit}><Pencil size={14} />编辑原文</button>} />
  }

  return (
    <article className="inspiration-result">
      <div className="inspiration-result-kicker">AI 整理结果</div>
      <h1>{note.title}</h1>
      <div className="inspiration-result-meta">版本 {note.analysisRevision} · {formatTime(note.organizedAt || note.updatedAt)}</div>
      <blockquote>{note.summary}</blockquote>
      <MarkdownRenderer content={note.bodyMarkdown} />
      {note.questions.length > 0 && <section className="inspiration-questions"><h2>执行前需要确认</h2><ul>{note.questions.map((question) => <li key={question}>{question}</li>)}</ul></section>}
      <section className="inspiration-candidate-section">
        <div className="inspiration-section-heading"><h2>候选任务</h2><span>每项独立确认，不会交给整理 Agent 自动执行</span></div>
        <div className="inspiration-candidate-list">
          {note.candidates.map((candidate, index) => (
            <article className="inspiration-candidate" key={candidate.id}>
              <div className="inspiration-candidate-main">
                <small>候选 {index + 1}</small>
                <h3>{candidate.title}</h3>
                <p>{candidate.descriptionMarkdown.replace(/[#*_>`-]/g, '').replace(/\s+/g, ' ').slice(0, 150)}</p>
                <div className="inspiration-agent"><Bot size={14} /><strong>{candidate.suggestedAgentName || '待选择 Agent'}</strong>{candidate.agentReason && <span>{candidate.agentReason}</span>}</div>
              </div>
              <div className="inspiration-candidate-actions">
                <span className={candidate.taskId ? 'is-created' : ''}>{candidate.taskId ? <CircleCheck size={14} /> : <CircleDashed size={14} />}{candidate.taskId ? taskLabel(candidate.taskStatus) : '尚未创建'}</span>
                {!candidate.taskId && <><button type="button" className="inspiration-secondary compact" onClick={() => onCandidateAction(candidate, 'edit')}>编辑任务</button><button type="button" className="inspiration-secondary compact" onClick={() => onCandidateAction(candidate, 'create')}>只创建</button><button type="button" className="inspiration-primary compact" onClick={() => onCandidateAction(candidate, 'execute')}><Play size={13} />执行此任务</button></>}
                {candidate.taskId && <button type="button" className="inspiration-secondary compact" onClick={() => onOpenTask(candidate.taskId!)}><ExternalLink size={13} />打开任务</button>}
                {candidate.executionSessionId && <button type="button" className="inspiration-primary compact" onClick={() => onOpenSession(candidate.executionSessionId!)}><ExternalLink size={13} />执行会话</button>}
              </div>
            </article>
          ))}
          {note.candidates.length === 0 && <div className="inspiration-no-candidates">当前分析没有生成候选任务，可以进入灵感会话继续讨论。</div>}
        </div>
      </section>
    </article>
  )
}

function ResultState({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="inspiration-result-state">{icon}<strong>{title}</strong><span>{detail}</span>{action}</div>
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function taskLabel(status: string | null): string {
  if (status === 'running') return '执行中'
  if (status === 'needs_input') return '需要确认'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '已创建'
}
