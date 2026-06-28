import { useAgentStore } from '../../stores/agent.store'
import { useProjectStore } from '../../stores/project.store'
import type { AgentData } from '../../stores/agent.store'

interface AgentListProps {
  selectedAgentId: string | null
  onSelect: (agentId: string) => void
}

export function AgentList({ selectedAgentId, onSelect }: AgentListProps) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const agents = useAgentStore((s) => s.agents)
  const projectAgents = agents.filter((a) => !currentProjectId || a.project_id === currentProjectId)

  return (
    <aside className="am-col">
      <div className="am-header">
        <div>
          <div className="am-eyebrow">Agent</div>
          <h2>Agent 记忆</h2>
        </div>
      </div>
      <div className="am-list">
        {projectAgents.length === 0 ? (
          <div className="am-empty">当前项目下暂无 Agent</div>
        ) : (
          projectAgents.map((a) => (
            <AgentListItem key={a.id} agent={a} active={a.id === selectedAgentId} onSelect={onSelect} />
          ))
        )}
      </div>
    </aside>
  )
}

function AgentListItem({ agent, active, onSelect }: { agent: AgentData; active: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      className={`am-item${active ? ' is-active' : ''}`}
      onClick={() => onSelect(agent.id)}
    >
      <span className="am-item-title">{agent.name}</span>
      <span className="am-item-meta">{agent.type}</span>
    </button>
  )
}
