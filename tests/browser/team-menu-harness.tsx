import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamConversationList } from '../../ui/src/components/team/TeamConversationList'
import { wsClient } from '../../ui/src/services/ws-client'
import { teamCacheKey, teamListCache } from '../../ui/src/components/team/team-view-cache'

const team = { id: 't', project_id: 'p', name: '测试团队', description: null, status: 'active', created_at: '', updated_at: '', archived_at: null }
let rows = [{ id: 'c', team_id: 't', master_session_id: 's', title: '测试会话', status: 'active', updated_at: new Date().toISOString() }]
teamListCache.set(teamCacheKey('p', 't'), rows)
wsClient.request = async (msg: Record<string, unknown>): Promise<unknown> => {
  if (msg.type === 'team.conversation.list') { await new Promise(resolve => setTimeout(resolve, 300)); return [...rows] }
  if (msg.type === 'team.conversation.rename') rows = rows.map(row => ({ ...row, title: String(msg.title) }))
  if (msg.type === 'team.conversation.archive') rows = rows.map(row => ({ ...row, status: 'archived' }))
  if (msg.type === 'team.conversation.delete') rows = []
  return {}
}
function Harness() {
  const [selected, setSelected] = useState<{ id: string; title: string } | null>(rows[0])
  const [, setMaster] = useState<string | null>('s')
  return <><div id="selected">{selected?.title || '空'}</div><TeamConversationList team={team} activeId={selected?.id || null} onSelect={setSelected} onMasterSession={setMaster} /></>
}
createRoot(document.getElementById('root')!).render(<Harness />)
