import type React from 'react'
import type { ToolBindingData, ToolData, ToolProfileData } from '../../stores/tool.store'

interface AgentToolPermissionPanelProps {
  agents: { id: string; name: string; runtime?: string; project_id?: string | null }[]
  tools: ToolData[]
  bindings: ToolBindingData[]
  profiles: ToolProfileData[]
  selectedAgentId: string
  onSelectAgent: (agentId: string) => void
  onApplyProfile: (profileId: string, agentId: string) => Promise<void>
  onSetBinding: (
    toolId: string,
    scope: string,
    targetId?: string,
    configOverride?: object,
    enabled?: boolean,
  ) => Promise<void>
}

export function AgentToolPermissionPanel({
  agents,
  tools,
  bindings,
  profiles,
  selectedAgentId,
  onSelectAgent,
  onApplyProfile,
  onSetBinding,
}: AgentToolPermissionPanelProps) {
  const teamTools = tools.filter((tool) => tool.name.startsWith('team.')).sort((a, b) => a.name.localeCompare(b.name))
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)

  const bindingFor = (toolId: string) =>
    bindings.find(
      (binding) => binding.tool_id === toolId && binding.scope === 'agent' && binding.target_id === selectedAgentId,
    )
  const isAllowed = (toolId: string) => {
    const agentBinding = bindingFor(toolId)
    if (agentBinding) return agentBinding.enabled === 1
    const projectBinding = selectedAgent?.project_id
      ? bindings.find(
          (binding) =>
            binding.tool_id === toolId && binding.scope === 'project' && binding.target_id === selectedAgent.project_id,
        )
      : undefined
    if (projectBinding) return projectBinding.enabled === 1
    return bindings.some(
      (binding) =>
        binding.tool_id === toolId && binding.scope === 'global' && !binding.target_id && binding.enabled === 1,
    )
  }

  return (
    <div style={{ ...toolCard, padding: 18, marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Agent 工具权限</h2>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '6px 0 0' }}>
            Team 工具默认不全局开放，需要给具体 Agent 绑定方法或套用权限模板。
          </p>
        </div>
        <select
          value={selectedAgentId}
          onChange={(event) => onSelectAgent(event.target.value)}
          style={{ ...inputStyle, width: 260 }}
        >
          <option value="">选择 Agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
              {agent.runtime ? ` (${agent.runtime})` : ''}
            </option>
          ))}
        </select>
      </div>

      {!selectedAgent && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-3)' }}>
          选择一个 Agent 后，可以配置它能看到哪些 team.* MCP 方法。
        </div>
      )}

      {selectedAgent && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: 10,
              marginTop: 14,
            }}
          >
            {profiles.map((profile) => (
              <button
                key={profile.id}
                onClick={() => onApplyProfile(profile.id, selectedAgent.id)}
                style={{ ...profileCard, textAlign: 'left' }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-1)' }}>{profile.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
                  {profile.description}
                </div>
                <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 8 }}>
                  {profile.toolNames.length} 个方法
                </div>
              </button>
            ))}
          </div>

          <div
            style={{
              marginTop: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 8,
            }}
          >
            {teamTools.map((tool) => {
              const binding = bindingFor(tool.id)
              const allowed = isAllowed(tool.id)
              return (
                <label key={tool.id} style={methodRow(allowed)}>
                  <input
                    type="checkbox"
                    checked={allowed}
                    onChange={(event) =>
                      event.target.checked
                        ? onSetBinding(tool.id, 'agent', selectedAgent.id, undefined, true)
                        : onSetBinding(tool.id, 'agent', selectedAgent.id, undefined, false)
                    }
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-1)' }}>
                      {tool.name}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11,
                        color: 'var(--text-3)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tool.display_name}
                    </span>
                    {binding?.enabled === 0 && (
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--red)', marginTop: 3 }}>
                        已显式隐藏
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const toolCard: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  overflow: 'hidden',
  transition: 'box-shadow .2s',
}
const inputStyle: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 13,
  background: 'var(--bg-1)',
  color: 'var(--text-1)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
const profileCard: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg-2)',
  padding: '10px 12px',
  cursor: 'pointer',
}
const methodRow = (allowed: boolean): React.CSSProperties => ({
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: allowed ? 'var(--blue-light)' : 'var(--bg-2)',
  cursor: 'pointer',
})
