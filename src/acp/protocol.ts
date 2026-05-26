export interface AcpRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface AcpResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface AcpNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export interface AcpInitializeResult {
  protocolVersion: string
  capabilities: Record<string, unknown>
  serverInfo: { name: string; version: string }
}

export interface AcpSessionCreateResult {
  sessionId: string
}

export interface AcpContentBlock {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result'
  text?: string
  thinking?: string
  toolCallId?: string
  toolName?: string
  toolInput?: string
  toolOutput?: string
}

export interface AcpSessionUpdate {
  sessionId: string
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_start' | 'message_done' | 'permission_request'
  contentBlock?: AcpContentBlock
  delta?: { type: string; text?: string }
  permissionRequest?: { id: string; description: string; options: string[] }
}
