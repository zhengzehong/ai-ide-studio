import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamAgentDock, type TeamDockMember, type TeamMemberLiveStatus } from '../../ui/src/components/team/TeamAgentDock'
import { TeamAgentSettingsModal, TeamMemberRemoveConfirm } from '../../ui/src/components/team/TeamAgentSettingsModal'

const initialMembers: TeamDockMember[] = [
  {
    id: 'tm-master', agent_id: 'a1', session_id: 's1', name: 'Master', role: 'leader',
    modelConfig: {
      modelProfileMode: 'fixed', modelProfileId: 'p1', systemPromptOverride: null, runtime: 'claude',
      effective: { name: 'master-model', source: 'Master 档案' },
      fallback: { name: 'master-model', source: 'Agent 配置' },
    },
  },
  {
    id: 'tm-1', agent_id: 'a2', session_id: 's2', name: 'Dev-GLM', role: 'member',
    modelConfig: {
      modelProfileMode: 'inherit', modelProfileId: null, systemPromptOverride: null, runtime: 'claude',
      effective: { name: 'master-model', source: '继承 Master' },
      fallback: { name: '系统默认', source: '未指定档案' },
    },
  },
]

const profiles = [
  { id: 'p1', name: 'claude-astra', runtime: 'claude', enabled: true },
  { id: 'p2', name: 'codex-only', runtime: 'codex', enabled: true },
] as never

const statusBySessionId: Record<string, TeamMemberLiveStatus> = {
  s1: { running: true, waiting: false, label: '执行中' },
  s2: { running: false, waiting: false, label: '空闲' },
}

function Harness() {
  const [members, setMembers] = useState(initialMembers)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const log = (message: string): void => setEvents((current) => [...current, message])
  const settingsMember = members.find((member) => member.id === settingsId) || null
  const confirmMember = members.find((member) => member.id === confirmId) || null
  const masterEffective = members.find((member) => member.role === 'leader')?.modelConfig?.effective || null
  return (
    <main>
      <div id="events">{events.join('|')}</div>
      <div style={{ height: 320, background: 'var(--bg-2, #f5f5f5)' }}>消息列表占位（dock 悬浮层不应挤压此区域高度）</div>
      {/* 与 TeamChatPane 一致：dock 锚在 position:relative 的 Composer 包裹层上方 */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TeamAgentDock
          members={members}
          statusBySessionId={statusBySessionId}
          onLocate={(member) => log(`locate:${member.id}`)}
          onOpenSettings={(member) => setSettingsId(member.id)}
          onRemoveRequest={(member) => { setSettingsId(null); setConfirmId(member.id) }}
        />
        <div id="composer" style={{ height: 56, margin: '0 20px 16px', border: '1px solid #ccc', display: 'flex', alignItems: 'center', padding: '0 12px' }}>Composer 占位</div>
      </div>
      {settingsMember?.modelConfig && (
        <TeamAgentSettingsModal
          member={settingsMember}
          config={settingsMember.modelConfig}
          masterEffective={masterEffective}
          modelProfiles={profiles}
          onLoadProfiles={() => undefined}
          onSave={async (input) => {
            log(`save:${JSON.stringify(input)}`)
            setMembers((current) => current.map((item) => item.id === settingsMember.id
              ? {
                ...item,
                modelConfig: {
                  ...item.modelConfig!,
                  modelProfileMode: input.modelProfileMode,
                  modelProfileId: input.modelProfileId,
                  systemPromptOverride: input.systemPromptOverride,
                  effective: input.modelProfileMode === 'fixed' ? { name: 'claude-astra', source: '独立配置' } : item.modelConfig!.effective,
                },
              }
              : item))
            setSettingsId(null)
          }}
          onRemoveRequest={() => { setSettingsId(null); setConfirmId(settingsMember.id) }}
          onClose={() => setSettingsId(null)}
        />
      )}
      {confirmMember && (
        <TeamMemberRemoveConfirm
          memberName={confirmMember.name}
          busy={removing}
          onCancel={() => setConfirmId(null)}
          onConfirm={() => {
            setRemoving(true)
            window.setTimeout(() => {
              setMembers((current) => current.filter((member) => member.id !== confirmMember.id))
              setRemoving(false)
              setConfirmId(null)
              log('removed')
            }, 50)
          }}
        />
      )}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Harness />)
