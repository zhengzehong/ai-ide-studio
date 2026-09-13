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
      agentSystemPrompt: 'Master 人设',
    },
  },
  {
    id: 'tm-1', agent_id: 'a2', session_id: 's2', name: 'Dev-GLM', role: 'member',
    modelConfig: {
      modelProfileMode: 'inherit', modelProfileId: null, systemPromptOverride: null, runtime: 'claude',
      effective: { name: 'master-model', source: '继承 Master' },
      fallback: { name: '系统默认', source: '未指定档案' },
      agentSystemPrompt: '成员模板人设提示词',
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
  const [withImageStrip, setWithImageStrip] = useState(false)
  const [events, setEvents] = useState<string[]>([])
  const log = (message: string): void => setEvents((current) => [...current, message])
  const settingsMember = members.find((member) => member.id === settingsId) || null
  const confirmMember = members.find((member) => member.id === confirmId) || null
  const masterEffective = members.find((member) => member.role === 'leader')?.modelConfig?.effective || null
  return (
    // 与 .conversation-pane 一致：flex 列 + 固定视口高度，消息列表 flex:1 吸收高度、
    // Composer 包裹层钉在底部（flex item 含子 margin，不发生外边距塌陷）——贴图增高 shell 时消耗列表高度，dock 不动
    <main style={{ display: 'flex', flexDirection: 'column', height: 800 }}>
      <button onClick={() => setWithImageStrip((value) => !value)} style={{ flexShrink: 0 }}>模拟贴图</button>
      <div id="events" style={{ flexShrink: 0 }}>{events.join('|')}</div>
      <div style={{ flex: 1, minHeight: 0, background: 'var(--bg-2, #f5f5f5)' }}>消息列表占位（dock 悬浮层脱离文档流，不挤压此区域）</div>
      {/* 与 TeamChatPane 一致：dock 锚在 position:relative 的 Composer 包裹层；
          图片条模拟 .conversation-image-attachments（输入框框体外、shell 内），增高 shell 不应移动 dock */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <TeamAgentDock
          members={members}
          statusBySessionId={statusBySessionId}
          onLocate={(member) => log(`locate:${member.id}`)}
          onOpenSettings={(member) => setSettingsId(member.id)}
          onRemoveRequest={(member) => { setSettingsId(null); setConfirmId(member.id) }}
        />
        <div style={{ margin: '0 20px 16px' }}>
          {withImageStrip && <div style={{ height: 52, marginBottom: 8, border: '1px dashed #999', boxSizing: 'border-box' }}>图片附件条（52px + 8px 间距）</div>}
          <div id="composer" style={{ height: 120, border: '1px solid #ccc', boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 12px' }}>Composer 占位（静止高度 120 = textarea 70 + toolbar 48 + 边框 2）</div>
        </div>
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
                  effective: input.modelProfileMode === 'fixed' ? { name: 'claude-astra', source: '独立配置' } : item.modelConfig!.effective,
                },
              }
              : item))
            // 与 TeamChatPane 一致：保存回调不关弹窗（由弹窗编排全部成功后统一 onClose）
          }}
          onSaveSystemPrompt={async (systemPrompt) => {
            // 模拟提示词保存失败：内容含「失败」即拒绝，验证 P2（部分失败弹窗不关）
            if (systemPrompt.includes('失败')) throw new Error('提示词保存失败（模拟）')
            log(`savePrompt:${systemPrompt}`)
            setMembers((current) => current.map((item) => item.id === settingsMember.id
              ? { ...item, modelConfig: { ...item.modelConfig!, agentSystemPrompt: systemPrompt } }
              : item))
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
