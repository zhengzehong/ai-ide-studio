import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SESSION_COMMAND_MAX_BYTES,
  createHttpCommandClient,
  createWsCommandClient,
  resolveCommandTransport,
  toCommandImages,
} from '../../ui/src/services/command-client.ts'

describe('HTTP command client', () => {
  it('uses the same 16 MiB default and rejects oversized prompts before fetch', async () => {
    expect(DEFAULT_SESSION_COMMAND_MAX_BYTES).toBe(16 * 1024 * 1024)
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createHttpCommandClient({
      fetchImpl,
      getAccessToken: () => '',
      subscribe: () => undefined,
      maxCommandBytes: 128,
    })

    await expect(client.execute({
      ...promptCommand(),
      content: 'x'.repeat(256),
    })).rejects.toThrow('消息和图片总大小超过限制')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps inline images and excludes persisted path-only attachment records', () => {
    expect(toCommandImages([
      { data: 'YWJj', mimeType: 'image/png', name: 'a.png', order: 1 },
      { mimeType: 'image/png', path: 'attachments/existing.png', name: 'existing.png' },
    ])).toEqual([
      { data: 'YWJj', mimeType: 'image/png', name: 'a.png', order: 1 },
    ])
  })

  it('subscribes before posting a Prompt with token and idempotency headers', async () => {
    const order: string[] = []
    const subscribe = vi.fn(() => { order.push('subscribe') })
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      order.push('fetch')
      return jsonResponse({
        data: { commandId: 'command-1', status: 'accepted', duplicate: false },
      }, 202)
    })
    const client = createHttpCommandClient({
      fetchImpl,
      getAccessToken: () => 'local-secret',
      subscribe,
    })

    const receipt = await client.execute(promptCommand())

    expect(order).toEqual(['subscribe', 'fetch'])
    expect(subscribe).toHaveBeenCalledWith(['session-1'])
    expect(receipt).toEqual({ commandId: 'command-1', status: 'accepted', duplicate: false })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/v1/commands')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'command-1',
      'x-ai-ide-token': 'local-secret',
    })
  })

  it('surfaces server failures and validates response envelopes', async () => {
    const unavailable = createHttpCommandClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: '命令服务暂不可用' }, 503)),
      getAccessToken: () => '',
      subscribe: () => undefined,
    })
    await expect(unavailable.execute(promptCommand())).rejects.toThrow('命令服务暂不可用')

    const malformed = createHttpCommandClient({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { ok: true } })),
      getAccessToken: () => '',
      subscribe: () => undefined,
    })
    await expect(malformed.execute(promptCommand())).rejects.toThrow('命令响应无效')
  })
})

describe('WS rollback command client', () => {
  it('keeps the legacy Prompt and request frame shapes', async () => {
    const send = vi.fn()
    const request = vi.fn(async () => ({ ok: true }))
    const subscribe = vi.fn()
    const client = createWsCommandClient({ send, request, subscribe })

    await expect(client.execute(promptCommand())).resolves.toEqual({
      commandId: 'command-1',
      status: 'accepted',
      duplicate: false,
    })
    await client.execute({
      commandId: 'command-cancel',
      type: 'session.cancel',
      sessionId: 'session-1',
    })

    expect(subscribe).toHaveBeenCalledWith(['session-1'])
    expect(send).toHaveBeenCalledWith({
      type: 'prompt',
      sessionId: 'session-1',
      clientMessageId: 'message-1',
      content: 'hello',
    })
    expect(request).toHaveBeenCalledWith({ type: 'session.cancel', sessionId: 'session-1' })
  })

  it('selects HTTP by default and WS only for tests or explicit rollback', () => {
    expect(resolveCommandTransport('production', undefined)).toBe('http')
    expect(resolveCommandTransport('development', undefined)).toBe('http')
    expect(resolveCommandTransport('production', 'ws')).toBe('ws')
    expect(resolveCommandTransport('test', undefined)).toBe('ws')
  })
})

function promptCommand() {
  return {
    commandId: 'command-1',
    type: 'prompt' as const,
    sessionId: 'session-1',
    clientMessageId: 'message-1',
    content: 'hello',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
