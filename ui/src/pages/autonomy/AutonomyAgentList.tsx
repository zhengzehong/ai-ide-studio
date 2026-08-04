import { Bot, Circle } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { AgentAutonomyStateData } from '../../stores/autonomy.store'

interface AutonomyAgentListProps {
  agents: AgentData[]
  states: AgentAutonomyStateData[]
  selectedAgentId: string | null
  onSelect: (agentId: string) => void
}

export function AutonomyAgentList({ agents, states, selectedAgentId, onSelect }: AutonomyAgentListProps) {
  const names = new Map(agents.map((agent) => [agent.id, agent]))
  return (
    <aside className="autonomy-agent-list">
      <div className="autonomy-panel-title">自主 Agent</div>
      <div className="autonomy-agent-scroll">
        {states.map((state) => {
          const agent = names.get(state.agentId)
          const selected = state.agentId === selectedAgentId
          return (
            <button
              key={state.agentId}
              type="button"
              className={`autonomy-agent-row${selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(state.agentId)}
            >
              <span className="autonomy-agent-icon"><Bot size={15} /></span>
              <span className="autonomy-agent-copy">
                <strong>{agent?.name ?? state.agentId}</strong>
                <small>{state.runtime}</small>
              </span>
              <Circle
                size={9}
                fill={state.config.enabled ? 'var(--green)' : 'var(--text-3)'}
                color={state.config.enabled ? 'var(--green)' : 'var(--text-3)'}
                aria-label={state.config.enabled ? '已启用' : '未启用'}
              />
            </button>
          )
        })}
        {states.length === 0 && <div className="autonomy-empty-small">当前项目没有 Agent</div>}
      </div>
    </aside>
  )
}
