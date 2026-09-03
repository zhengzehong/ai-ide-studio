import { useState } from 'react'
import './advisor.css'
import { ListTodo, Settings2, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import type { AdvisorArtifact, AdvisorSuggestion, AdvisorSuggestionView } from '../../stores/advisor.store'
import { formatArtifactSize, isGlmAgent, parseArtifact, parseEvidence } from '../../stores/advisor.store'

export type AdvisorRightTab = 'tasks' | 'suggestions'

const GLM_TAG_TEXT = '推荐 · 快、便宜、中文好'

interface AdvisorTabBarProps {
  active: AdvisorRightTab
  pendingCount: number
  pulse: boolean
  onSelectTab: (tab: AdvisorRightTab) => void
  onOpenSettings: () => void
  onCreateTask: () => void
}

/** 右侧面板 tab 条：任务｜建议（含未处理徽标）＋ 右侧动作位（新建 / ⚙ 参谋设置） */
export function AdvisorTabBar({ active, pendingCount, pulse, onSelectTab, onOpenSettings, onCreateTask }: AdvisorTabBarProps) {
  return (
    <div className="advisor-tabbar">
      <button
        type="button"
        className={`advisor-tab${active === 'tasks' ? ' advisor-tab-active' : ''}`}
        onClick={() => onSelectTab('tasks')}
      >
        <ListTodo size={14} /> 任务
      </button>
      <button
        type="button"
        className={`advisor-tab${active === 'suggestions' ? ' advisor-tab-active' : ''}`}
        onClick={() => onSelectTab('suggestions')}
      >
        建议
        {pendingCount > 0 && (
          <span className={`advisor-tab-badge${pulse ? ' advisor-tab-badge-pulse' : ''}`}>{pendingCount}</span>
        )}
      </button>
      <span className="advisor-tabbar-spacer" />
      {active === 'tasks' ? (
        <button type="button" className="advisor-tabbar-action advisor-tabbar-action-primary" onClick={onCreateTask}>
          <Plus size={12} /> 新建
        </button>
      ) : (
        <button type="button" className="advisor-tabbar-action" onClick={onOpenSettings} title="参谋设置">
          <Settings2 size={14} /> 参谋设置
        </button>
      )}
    </div>
  )
}

function summaryOf(description: string): string {
  const lines = description
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
  return lines.slice(0, 2).join(' · ')
}

function typeLabel(type: AdvisorSuggestion['type']): string {
  return type === 'plan' ? '📄 方案' : '💡 行动'
}

function statusLine(suggestion: AdvisorSuggestion): string {
  if (suggestion.status === 'accepted') return '✔ 已派发执行'
  if (suggestion.status === 'created') return '📋 已创建任务（未派发）'
  if (suggestion.status === 'ignored') return '已忽略'
  return '已过期，仅存档展示'
}

interface SuggestionCardProps {
  suggestion: AdvisorSuggestion
  agents: Array<{ id: string; name: string }>
  highlight: boolean
  onJumpToSession: (sessionId: string) => void
  onOpenArtifact: (suggestion: AdvisorSuggestion, artifact: AdvisorArtifact) => void
  onExecute: (suggestion: AdvisorSuggestion) => void
  onIgnore: (suggestion: AdvisorSuggestion) => void
  onOpenTask: (taskId: string) => void
}

export function SuggestionCard({
  suggestion,
  agents,
  highlight,
  onJumpToSession,
  onOpenArtifact,
  onExecute,
  onIgnore,
  onOpenTask,
}: SuggestionCardProps) {
  const active = suggestion.status === 'pending' || suggestion.status === 'viewed'
  const evidence = parseEvidence(suggestion)
  const artifact = parseArtifact(suggestion)
  const agent = suggestion.suggested_agent_id
    ? agents.find((item) => item.id === suggestion.suggested_agent_id)
    : undefined
  const statusClass =
    suggestion.status === 'accepted'
      ? ' advisor-card-accepted'
      : suggestion.status === 'created'
        ? ' advisor-card-created'
        : suggestion.status === 'ignored'
          ? ' advisor-card-ignored'
          : ''

  return (
    <div className={`advisor-card${statusClass}${highlight ? ' advisor-card-insert' : ''}`}>
      <div className="advisor-card-head">
        <div style={{ display: 'flex', gap: 6, overflow: 'hidden' }}>
          {evidence.map((item) => (
            <button
              key={item.sessionId}
              type="button"
              className="advisor-evidence"
              title={`跳转来源会话：${item.title || item.sessionId}`}
              onClick={() => onJumpToSession(item.sessionId)}
            >
              来源：{item.title || '会话'}
            </button>
          ))}
        </div>
        <span className={`advisor-type-label ${suggestion.type === 'plan' ? 'advisor-type-plan' : 'advisor-type-action'}`}>
          {typeLabel(suggestion.type)}
        </span>
      </div>

      <div className="advisor-card-title">{suggestion.title}</div>
      {summaryOf(suggestion.description_markdown) && (
        <div className="advisor-card-summary">{summaryOf(suggestion.description_markdown)}</div>
      )}

      {artifact && (
        <div className="advisor-artifact-bar">
          <span className="advisor-artifact-name" title={artifact.name}>
            📎 {artifact.name}（{formatArtifactSize(artifact.size)}）
          </span>
          <button type="button" className="advisor-artifact-open" onClick={() => onOpenArtifact(suggestion, artifact)}>
            打开
          </button>
        </div>
      )}

      {agent && (
        <div className="advisor-agent-row">
          <span>
            推荐执行：<span className="advisor-agent-name">{agent.name}</span>
          </span>
          {isGlmAgent(agent.name) && <span className="advisor-glm-tag">{GLM_TAG_TEXT}</span>}
        </div>
      )}

      {!active && (
        <div className="advisor-card-status">
          {statusLine(suggestion)}
          {suggestion.task_id && (
            <button type="button" onClick={() => onOpenTask(suggestion.task_id!)}>
              {' '}
              · 打开任务
            </button>
          )}
          {suggestion.execution_session_id && (
            <button type="button" onClick={() => onJumpToSession(suggestion.execution_session_id!)}>
              {' '}
              · 跳转执行会话
            </button>
          )}
        </div>
      )}

      {active && (
        <div className="advisor-card-actions">
          <button type="button" className="advisor-button-primary" onClick={() => onExecute(suggestion)}>
            ▶ 查看并执行
          </button>
          <button type="button" className="advisor-button-secondary" onClick={() => onIgnore(suggestion)}>
            忽略
          </button>
        </div>
      )}
    </div>
  )
}

interface CollapsedGroup {
  key: string
  label: string
  items: AdvisorSuggestion[]
}

const EMPTY_TEXT = '参谋没有值得说的会保持沉默'
const EMPTY_HINT = '开启参谋后，它会在会话出现值得改进的点时主动给出建议。'

interface SuggestionPanelProps {
  view: AdvisorSuggestionView | null
  loading: boolean
  error: string | null
  agents: Array<{ id: string; name: string }>
  highlightIds?: string[]
  onJumpToSession: (sessionId: string) => void
  onOpenArtifact: (suggestion: AdvisorSuggestion, artifact: AdvisorArtifact) => void
  onExecute: (suggestion: AdvisorSuggestion) => void
  onIgnore: (suggestion: AdvisorSuggestion) => void
  onOpenTask: (taskId: string) => void
  onRetry: () => void
}

/** 右侧「建议」tab 面板：主列表（未处理）＋ 沉底折叠区（已处理/已忽略/已过期） */
export function SuggestionPanel({
  view,
  loading,
  error,
  agents,
  highlightIds = [],
  onJumpToSession,
  onOpenArtifact,
  onExecute,
  onIgnore,
  onOpenTask,
  onRetry,
}: SuggestionPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  if (loading && !view) {
    return (
      <div className="advisor-panel">
        <div className="advisor-empty">正在加载参谋建议…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="advisor-panel">
        <div className="advisor-error">
          {error}
          <div>
            <button type="button" onClick={onRetry}>重试</button>
          </div>
        </div>
      </div>
    )
  }
  if (!view) return null

  const settled = view.settled
  const groups: CollapsedGroup[] = [
    { key: 'dispatched', label: '已处理', items: settled.filter((item) => item.status === 'accepted' || item.status === 'created') },
    { key: 'ignored', label: '已忽略', items: settled.filter((item) => item.status === 'ignored') },
    { key: 'expired', label: '已过期', items: view.expired },
  ]
  const visibleGroups = groups.filter((group) => group.items.length > 0)
  const isEmpty = view.suggestions.length === 0 && visibleGroups.length === 0

  return (
    <div className="advisor-panel">
      {isEmpty ? (
        <div className="advisor-empty">
          {EMPTY_TEXT}
          <div style={{ fontSize: 12 }}>{EMPTY_HINT}</div>
        </div>
      ) : (
        <>
          {view.suggestions.map((suggestion) => (
            <SuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              agents={agents}
              highlight={highlightIds.includes(suggestion.id)}
              onJumpToSession={onJumpToSession}
              onOpenArtifact={onOpenArtifact}
              onExecute={onExecute}
              onIgnore={onIgnore}
              onOpenTask={onOpenTask}
            />
          ))}
          {visibleGroups.map((group) => (
            <div key={group.key}>
              <button
                type="button"
                className="advisor-collapsed"
                onClick={() => setExpanded((prev) => ({ ...prev, [group.key]: !prev[group.key] }))}
              >
                {expanded[group.key] ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {group.label}（{group.items.length} 条）
              </button>
              {expanded[group.key] && (
                <div className="advisor-collapsed-list">
                  {group.items.map((suggestion) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      agents={agents}
                      highlight={false}
                      onJumpToSession={onJumpToSession}
                      onOpenArtifact={onOpenArtifact}
                      onExecute={onExecute}
                      onIgnore={onIgnore}
                      onOpenTask={onOpenTask}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
