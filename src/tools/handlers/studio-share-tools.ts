import { sessionShareStore } from '../../store/session-shares.js'
import { sessionShareManager, type CreateShareInput } from '../../core/session-share-manager.js'
import { agentStore } from '../../store/agents.js'
import { sessionStore } from '../../store/sessions.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'
import { errResult, optStr, requireStr } from './studio-task-crud-tools.js'

function parsePermission(value: unknown): 'chat' | 'readonly' {
  return value === 'readonly' ? 'readonly' : 'chat'
}

function parseVisibility(value: unknown): 'hide' | 'collapse' | 'expand' {
  if (value === 'hide') return 'hide'
  if (value === 'expand') return 'expand'
  return 'collapse'
}

function parseExpiresAt(value: unknown): string | null {
  if (value == null || value === '' || value === 'never') return null
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof value === 'number') {
    const d = new Date(Date.now() + value * 24 * 60 * 60 * 1000)
    return d.toISOString()
  }
  return null
}

export const studioShareCreateHandler: ToolHandler = {
  name: 'studio.share.create',
  description:
    '创建会话分享链接。AI Agent 在对话里主动调用,生成可分享给外部访客的链接。返回 {shareId, shareToken, url, shareName, permission, expiresAt}。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '要分享的会话 ID' },
      shareName: { type: 'string', description: '分享名字(访客看到的标题)' },
      agentIntro: { type: 'string', description: 'Agent 介绍,访客进入时展示' },
      permission: { type: 'string', enum: ['chat', 'readonly'], description: '访客权限,默认 chat' },
      toolCallVisibility: { type: 'string', enum: ['hide', 'collapse', 'expand'], description: '工具调用展示,默认 collapse' },
      expiresAt: { type: 'string', description: '过期时间 ISO 字符串或天数数字,留空=永久' },
    },
    required: ['sessionId', 'shareName', 'agentIntro'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const sessionId = requireStr(input, 'sessionId')
    const shareName = requireStr(input, 'shareName')
    const agentIntro = requireStr(input, 'agentIntro')
    const ownerAgentId = context.agentId
    if (!ownerAgentId) return errResult('context.agentId 缺失,无法创建分享')

    const session = sessionStore.get(sessionId)
    if (!session) return errResult(`会话不存在: ${sessionId}`)
    if (session.agent_id !== ownerAgentId) return errResult('只有会话所属 Agent 可以创建分享')

    const agent = agentStore.get(session.agent_id)
    if (!agent) return errResult(`Agent 不存在: ${session.agent_id}`)

    const createInput: CreateShareInput = {
      sessionId,
      ownerAgentId,
      shareName,
      agentIntro,
      permission: parsePermission(input.permission),
      toolCallVisibility: parseVisibility(input.toolCallVisibility),
      expiresAt: parseExpiresAt(input.expiresAt),
    }
    const share = sessionShareManager.createShare(createInput)
    const url = `/share/${share.share_token}`
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              shareId: share.id,
              shareToken: share.share_token,
              url,
              shareName: share.share_name,
              permission: share.permission,
              toolCallVisibility: share.tool_call_visibility,
              expiresAt: share.expires_at,
              createdAt: share.created_at,
            },
            null,
            2,
          ),
        },
      ],
    }
  },
}

export const studioShareRevokeHandler: ToolHandler = {
  name: 'studio.share.revoke',
  description: '撤销会话分享。链接立即失效,访客 WS 断开。返回 {shareId, revokedAt}。',
  inputSchema: {
    type: 'object',
    properties: {
      shareId: { type: 'string', description: '分享 ID' },
    },
    required: ['shareId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const shareId = requireStr(input, 'shareId')
    const share = sessionShareStore.getById(shareId)
    if (!share) return errResult(`分享不存在: ${shareId}`)
    if (context.agentId && share.owner_agent_id !== context.agentId) {
      return errResult('只有分享创建者可以撤销')
    }
    const revoked = sessionShareManager.revokeShare(shareId)
    if (!revoked) return errResult('撤销失败')
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ shareId: revoked.id, revokedAt: revoked.revoked_at }),
        },
      ],
    }
  },
}

export const studioShareListHandler: ToolHandler = {
  name: 'studio.share.list',
  description:
    '列出当前 Agent 的会话分享。可选 sessionId 过滤。返回数组 [{shareId, shareToken, sessionId, shareName, permission, status, visitCount, expiresAt, createdAt}]。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '可选,按会话过滤' },
    },
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    const ownerAgentId = context.agentId
    if (!ownerAgentId) return errResult('context.agentId 缺失')
    const sessionIdFilter = optStr(input, 'sessionId')
    const allShares = sessionShareManager.listSharesByOwner(ownerAgentId)
    const filtered = sessionIdFilter ? allShares.filter((s) => s.session_id === sessionIdFilter) : allShares
    const result = filtered.map((s) => {
      const now = Date.now()
      const expired = s.expires_at ? new Date(s.expires_at).getTime() < now : false
      const status = s.revoked_at ? 'revoked' : s.deleted_at ? 'deleted' : expired ? 'expired' : 'active'
      return {
        shareId: s.id,
        shareToken: s.share_token,
        sessionId: s.session_id,
        shareName: s.share_name,
        permission: s.permission,
        toolCallVisibility: s.tool_call_visibility,
        status,
        visitCount: s.visit_count,
        lastVisitedAt: s.last_visited_at,
        expiresAt: s.expires_at,
        createdAt: s.created_at,
      }
    })
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    }
  },
}
