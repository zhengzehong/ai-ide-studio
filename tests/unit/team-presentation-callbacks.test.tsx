import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import { TeamChatPane, emptySnapshot } from '../../ui/src/components/team/TeamChatPane'
import { teamCacheKey, teamChatCache } from '../../ui/src/components/team/team-view-cache'
import { normalizeMessage, type FilesPresentationInfo, type PreviewPresentationInfo } from '../../ui/src/stores/session-events'
import type { TeamData } from '../../ui/src/stores/team.store'

const team: TeamData = {
  id: 'team-1', project_id: 'project-1', name: '测试团队', description: null,
  status: 'active', created_at: '2026-09-11T00:00:00Z', updated_at: '2026-09-11T00:00:00Z', archived_at: null,
}

const files: FilesPresentationInfo = {
  kind: 'files', presentationId: 'files-1', projectId: team.project_id,
  title: '交付文件', createdAt: '2026-09-11T00:00:00Z',
  files: [{ path: 'docs/report.md', title: 'report.md', name: 'report.md', extension: '.md', size: 20, kind: 'text', language: 'markdown' }],
}

const preview: PreviewPresentationInfo = {
  kind: 'preview', previewId: 'preview-1',
  url: '/preview/preview-1', title: 'HTML 原型', target: 'pc', taskId: null, createdAt: '2026-09-11T00:00:00Z',
}

test('team conversation renders persisted files and preview cards through Workspace callbacks', () => {
  const masterSessionId = 'session-master'
  const message = normalizeMessage({
    id: 'message-1', session_id: masterSessionId, role: 'agent', content: '交付完成', thinking: null,
    tool_calls_json: null, decision_json: null, timestamp: '2026-09-11T00:00:00Z',
    presentations_json: JSON.stringify([files, preview]),
  })
  teamChatCache.set(teamCacheKey(team.project_id, team.id, 'conversation-1'), {
    members: [],
    snapshots: { [masterSessionId]: { ...emptySnapshot(masterSessionId), messages: [message] } },
    sources: new Map([[message.id, { message, sourceSessionId: masterSessionId, sourceMessageId: message.id }]]),
  })

  const html = renderToStaticMarkup(createElement(TeamChatPane, {
    team, conversation: { id: 'conversation-1', team_id: team.id, master_session_id: masterSessionId, title: '测试会话' },
    masterSessionId,
    onOpenFiles: vi.fn(), onOpenPreview: vi.fn(), onOpenResource: vi.fn(async () => ({ path: 'docs/report.md', name: 'report.md', kind: 'file', absolute: false })),
  }))

  expect(html).toContain('交付文件')
  expect(html).toContain('report.md')
  expect(html).toContain('HTML 原型')
})
