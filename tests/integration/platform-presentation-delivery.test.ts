import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'
import { messageStore, sessionStore } from '../../src/store/sessions.js'
import { turnProcessItemStore } from '../../src/store/turn-process-items.js'
import { startTurnProcess } from '../../src/core/turn-process-runtime.js'
import {
  recordPlatformPresentationResult,
  resetPlatformPresentationResults,
} from '../../src/core/platform-presentation-results.js'
import { handleRuntimeDone, handleRuntimePersistenceUpdate } from '../../src/runtime/api/runtime-ingress.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-presentation-delivery-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  resetPlatformPresentationResults()
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('platform presentation delivery', () => {
  test('persists a successful HTTP MCP result when Codex only reports an in-progress tool call', async () => {
    const session = sessionStore.create({ agentId: 'agent-codex', projectId: null })
    const messageId = 'message-codex-files'
    const toolInput = {
      title: 'Codex delivery',
      files: [{ path: 'report.md' }],
    }
    const presentation = {
      kind: 'files',
      presentationId: 'files-codex-delivery',
      projectId: 'project-1',
      title: 'Codex delivery',
      files: [
        { path: 'report.md', title: 'Report', name: 'report.md', extension: '.md', size: 10, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-07-24T00:00:00.000Z',
    }
    startTurnProcess(session.id, messageId)
    recordPlatformPresentationResult({
      auditId: 'audit-files',
      sessionId: session.id,
      agentId: 'agent-codex',
      toolName: 'files.present',
      input: toolInput,
      rawOutput: [{ type: 'text', text: JSON.stringify(presentation) }],
    })

    await handleRuntimePersistenceUpdate({
      sessionId: session.id,
      agentId: 'agent-codex',
      streamGeneration: 'generation-1',
      sequence: 1,
      update: {
        kind: 'session-update',
        sessionId: session.id,
        messageId,
        data: {
          messageId,
          role: 'system',
          toolCall: {
            id: 'codex-tool-call',
            title: 'mcp.ai-ide-tools.files.present',
            status: 'in_progress',
            rawInput: { server: 'ai-ide-tools', tool: 'files.present', arguments: toolInput },
          },
        },
      },
    })
    await handleRuntimeDone({
      sessionId: session.id,
      agentId: 'agent-codex',
      messageId,
      streamGeneration: 'generation-1',
      sequence: 2,
      stopReason: 'end_turn',
    })

    const message = messageStore.get(messageId)
    expect(message?.presentations_json).not.toBeNull()
    expect(JSON.parse(message?.presentations_json || '[]')).toEqual([presentation])
  })

  test('attaches an unmatched platform result before session done', async () => {
    const session = sessionStore.create({ agentId: 'agent-codex', projectId: null })
    const messageId = 'message-codex-fallback'
    const presentation = {
      kind: 'files',
      presentationId: 'files-codex-fallback',
      projectId: 'project-1',
      title: 'Fallback delivery',
      files: [
        { path: 'fallback.md', title: 'Fallback', name: 'fallback.md', extension: '.md', size: 12, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-07-24T00:00:00.000Z',
    }
    startTurnProcess(session.id, messageId)
    recordPlatformPresentationResult({
      auditId: 'audit-fallback',
      sessionId: session.id,
      agentId: 'agent-codex',
      toolName: 'files.present',
      input: { files: [{ path: 'fallback.md' }] },
      rawOutput: [{ type: 'text', text: JSON.stringify(presentation) }],
    })

    await handleRuntimeDone({
      sessionId: session.id,
      agentId: 'agent-codex',
      messageId,
      streamGeneration: 'generation-1',
      sequence: 1,
      stopReason: 'end_turn',
    })

    const message = messageStore.get(messageId)
    expect(JSON.parse(message?.presentations_json || '[]')).toEqual([presentation])
  })

  test('updates the original tool item when the ACP start arrives before the HTTP result', async () => {
    const session = sessionStore.create({ agentId: 'agent-codex', projectId: null })
    const messageId = 'message-codex-late-result'
    const toolInput = { files: [{ path: 'late.md' }] }
    const presentation = {
      kind: 'files',
      presentationId: 'files-codex-late',
      projectId: 'project-1',
      title: 'Late delivery',
      files: [
        { path: 'late.md', title: 'Late', name: 'late.md', extension: '.md', size: 8, kind: 'text', language: 'markdown' },
      ],
      createdAt: '2026-07-24T00:00:00.000Z',
    }
    startTurnProcess(session.id, messageId)
    await handleRuntimePersistenceUpdate({
      sessionId: session.id,
      agentId: 'agent-codex',
      streamGeneration: 'generation-1',
      sequence: 1,
      update: {
        kind: 'session-update',
        sessionId: session.id,
        messageId,
        data: {
          messageId,
          role: 'system',
          toolCall: {
            id: 'codex-late-tool-call',
            title: 'mcp.ai-ide-tools.files.present',
            status: 'in_progress',
            rawInput: { server: 'ai-ide-tools', tool: 'files.present', arguments: toolInput },
          },
        },
      },
    })
    recordPlatformPresentationResult({
      auditId: 'audit-late',
      sessionId: session.id,
      agentId: 'agent-codex',
      toolName: 'files.present',
      input: toolInput,
      rawOutput: [{ type: 'text', text: JSON.stringify(presentation) }],
    })
    await handleRuntimeDone({
      sessionId: session.id,
      agentId: 'agent-codex',
      messageId,
      streamGeneration: 'generation-1',
      sequence: 2,
      stopReason: 'end_turn',
    })

    expect(JSON.parse(messageStore.get(messageId)?.presentations_json || '[]')).toEqual([presentation])
    expect(turnProcessItemStore.list(messageId).filter((item) => item.kind === 'tool')).toHaveLength(1)
    const toolDetail = turnProcessItemStore.list(messageId, { includeDetail: true })
      .find((item) => item.kind === 'tool')?.detail_json
    expect(JSON.parse(toolDetail || '{}')).toMatchObject({
        id: 'codex-late-tool-call',
        status: 'completed',
      })
  })
})
