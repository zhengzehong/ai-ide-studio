import { describe, expect, it } from 'vitest'
import {
  MAX_SESSION_COMMAND_BYTES,
  parseSessionCommand,
} from '../../src/commands/session-command-types.js'

describe('session command contract', () => {
  it('uses a 16 MiB compatibility budget by default', () => {
    expect(MAX_SESSION_COMMAND_BYTES).toBe(16 * 1024 * 1024)
  })

  it('parses every supported command into a closed discriminated union', () => {
    expect(parseSessionCommand({
      commandId: 'cmd-prompt',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      content: 'hello',
      contextProjectId: 'project-1',
      inspirationNoteId: 'inspiration-1',
      images: [{ data: 'YWJj', mimeType: 'image/png' }],
    })).toEqual({
      commandId: 'cmd-prompt',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      content: 'hello',
      contextProjectId: 'project-1',
      inspirationNoteId: 'inspiration-1',
      images: [{ data: 'YWJj', mimeType: 'image/png' }],
    })

    expect(parseSessionCommand({
      commandId: 'cmd-cancel',
      type: 'session.cancel',
      sessionId: 'session-1',
    }).type).toBe('session.cancel')

    expect(parseSessionCommand({
      commandId: 'cmd-read',
      type: 'sessions.markRead',
      sessionId: 'session-1',
    }).type).toBe('sessions.markRead')

    expect(parseSessionCommand({
      commandId: 'cmd-unread',
      type: 'sessions.markUnread',
      sessionId: 'session-1',
    }).type).toBe('sessions.markUnread')

    expect(parseSessionCommand({
      commandId: 'cmd-permission',
      type: 'permission.respond',
      sessionId: 'session-1',
      permissionRequestId: 'permission-1',
      optionId: 'allow_once',
      cancelled: false,
    }).type).toBe('permission.respond')

    expect(parseSessionCommand({
      commandId: 'cmd-elicitation',
      type: 'elicitation.respond',
      sessionId: 'session-1',
      elicitationRequestId: 'elicitation-1',
      action: 'accept',
      content: { answer: 'yes', count: 2, enabled: true, choices: ['a'] },
    }).type).toBe('elicitation.respond')
  })

  it('rejects unsupported commands, missing identifiers, and unknown fields', () => {
    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'tasks.list',
      sessionId: 'session-1',
    })).toThrow('不支持的命令')

    expect(() => parseSessionCommand({
      commandId: '',
      type: 'session.cancel',
      sessionId: 'session-1',
    })).toThrow('commandId')

    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'session.cancel',
      sessionId: 'session-1',
      arbitraryRpcPayload: true,
    })).toThrow('未知字段')
  })

  it('accepts image-only prompts and rejects prompts without text or images', () => {
    expect(parseSessionCommand({
      commandId: 'cmd-image-only',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-image-only',
      content: '   ',
      images: [{ data: 'YWJj', mimeType: 'image/png' }],
    })).toMatchObject({
      type: 'prompt',
      content: '   ',
      images: [{ data: 'YWJj', mimeType: 'image/png' }],
    })

    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      content: '   ',
    })).toThrow('消息内容或图片不能为空')

  })

  it('rejects invalid image payloads', () => {

    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      content: 'image',
      images: [{ data: '', mimeType: 'text/plain' }],
    })).toThrow('图片')
  })

  it('rejects invalid permission and elicitation responses', () => {
    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'permission.respond',
      sessionId: 'session-1',
      permissionRequestId: 'permission-1',
      cancelled: 'false',
    })).toThrow('cancelled')

    expect(() => parseSessionCommand({
      commandId: 'cmd-1',
      type: 'elicitation.respond',
      sessionId: 'session-1',
      elicitationRequestId: 'elicitation-1',
      action: 'later',
    })).toThrow('action')
  })

  it('rejects commands above the transport size budget', () => {
    expect(() => parseSessionCommand({
      commandId: 'cmd-large',
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-large',
      content: 'x'.repeat(MAX_SESSION_COMMAND_BYTES),
    })).toThrow('请求体过大')
  })
})
