import { Bot, CheckCircle2, Circle, Loader2, MessageSquare, Users, Zap } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { TaskData } from '../../stores/task.store'
import type { TeamContextData, TeamMailboxData, TeamMemberData } from '../../stores/team.store'
import { TeamMemberRow } from './TeamMemberRow'
import { roleLabel } from './labels'
import { MarkdownRenderer } from '../MarkdownRenderer'

interface TeamContextPanelProps {
  context: TeamContextData
  agents: AgentData[]
  currentSessionId: string | null
  onSelectMember: (agentId: string, sessionId: string) => void
}

const statusLabels: Record<string, string> = {
  active: '活跃',
  removed: '已移除',
  backlog: '待办',
  planning: '规划中',
  executing: '执行中',
  reviewing: '审查中',
  completed: '已完成',
  cancelled: '已取消',
  blocked: '已阻塞',
}

const mailboxLabels: Record<string, string> = {
  message: '消息',
  report: '汇报',
  result: '结果',
  question: '问题',
  blocker: '阻塞',
}

export function TeamContextPanel({ context, agents, currentSessionId, onSelectMember }: TeamContextPanelProps) {
  if (!context.team) return null
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
  const memberMap = new Map(context.members.map((member) => [member.id, member]))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-1)',
          }}
        >
          <Users size={15} color="var(--blue)" /> {context.team.name}
        </div>
        <div style={{ marginTop: 5, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={pillStyle('var(--blue-light)', 'var(--blue)')}>Team 会话</span>
          <span style={pillStyle('var(--bg-2)', 'var(--text-3)')}>
            {statusLabels[context.team.status] || context.team.status}
          </span>
          {context.currentMember && (
            <span style={pillStyle('var(--bg-2)', 'var(--text-2)')}>当前：{roleLabel(context.currentMember.role)}</span>
          )}
        </div>
        {context.team.description && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
            {context.team.description}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        <SectionTitle icon={<Bot size={13} />} title="成员会话" count={context.members.length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
          {context.members.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              agent={agentMap.get(member.agent_id)}
              active={member.session_id === currentSessionId}
              onClick={() => onSelectMember(member.agent_id, member.session_id)}
            />
          ))}
        </div>

        <SectionTitle icon={<Circle size={13} />} title="Team 任务" count={context.tasks.length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 16 }}>
          {context.tasks.length === 0 ? (
            <EmptyText text="暂无 Team 任务" />
          ) : (
            context.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                assignee={task.assignee_member_id ? memberMap.get(task.assignee_member_id) : undefined}
              />
            ))
          )}
        </div>

        <SectionTitle icon={<MessageSquare size={13} />} title="最新汇报" count={context.mailbox.length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {context.mailbox.length === 0 ? (
            <EmptyText text="暂无成员汇报" />
          ) : (
            context.mailbox
              .slice()
              .reverse()
              .map((item) => (
                <MailboxRow
                  key={item.id}
                  item={item}
                  from={item.from_member_id ? memberMap.get(item.from_member_id) : undefined}
                />
              ))
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        margin: '4px 0 8px',
        fontSize: 12,
        fontWeight: 700,
        color: 'var(--text-2)',
      }}
    >
      {icon}
      {title}
      <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{count}</span>
    </div>
  )
}

function TaskRow({ task, assignee }: { task: TaskData; assignee?: TeamMemberData }) {
  const terminal = task.status === 'completed' || task.status === 'cancelled'
  const blocked = task.status === 'blocked'
  const icon = terminal ? (
    <CheckCircle2 size={12} />
  ) : blocked ? (
    <Zap size={12} />
  ) : (
    <Loader2 size={12} style={task.status === 'executing' ? { animation: 'spin 1s linear infinite' } : undefined} />
  )
  return (
    <div style={{ padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.4 }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        <span
          style={{
            ...pillStyle(statusBg(task.status), statusColor(task.status)),
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {icon}
          {task.stage || statusLabels[task.status] || task.status}
        </span>
        {assignee && <span style={pillStyle('var(--bg-2)', 'var(--text-2)')}>{assignee.name}</span>}
      </div>
      {task.description && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--text-3)',
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {task.description}
        </div>
      )}
    </div>
  )
}

function MailboxRow({ item, from }: { item: TeamMailboxData; from?: TeamMemberData }) {
  return (
    <div style={{ padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={pillStyle(mailboxBg(item.type), mailboxColor(item.type))}>
          {mailboxLabels[item.type] || item.type}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {from?.name || '系统'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', flexShrink: 0 }}>
          {formatTime(item.created_at)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5, maxHeight: 100, overflow: 'auto' }}>
        <MarkdownRenderer content={item.content} />
      </div>
    </div>
  )
}

function EmptyText({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '16px 8px',
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--text-3)',
        border: '1px dashed var(--border)',
        borderRadius: 9,
      }}
    >
      {text}
    </div>
  )
}


function statusBg(status: string): string {
  if (status === 'completed') return '#ecfdf5'
  if (status === 'blocked') return '#fef2f2'
  if (status === 'executing' || status === 'planning' || status === 'reviewing') return 'var(--blue-light)'
  return 'var(--bg-2)'
}

function statusColor(status: string): string {
  if (status === 'completed') return 'var(--green)'
  if (status === 'blocked') return 'var(--red)'
  if (status === 'executing' || status === 'planning' || status === 'reviewing') return 'var(--blue)'
  return 'var(--text-3)'
}

function mailboxBg(type: string): string {
  if (type === 'question') return '#fffbeb'
  if (type === 'blocker') return '#fef2f2'
  if (type === 'result' || type === 'report') return '#ecfdf5'
  return 'var(--bg-2)'
}

function mailboxColor(type: string): string {
  if (type === 'question') return '#d97706'
  if (type === 'blocker') return 'var(--red)'
  if (type === 'result' || type === 'report') return 'var(--green)'
  return 'var(--text-2)'
}

function pillStyle(background: string, color: string): React.CSSProperties {
  return { padding: '2px 7px', borderRadius: 999, background, color, fontSize: 10, fontWeight: 700, lineHeight: 1.6 }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
