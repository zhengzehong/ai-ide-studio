import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpCommandClient, createWsCommandClient } from '../../ui/src/services/command-client.js'
import { parseSessionCommand } from '../../src/commands/session-command-types.js'

afterEach(() => vi.unstubAllGlobals())
const command = { type: 'prompt' as const, commandId: 'cmd', sessionId: 's', clientMessageId: 'm', content: 'check this PC' }

describe('human message source propagation', () => {
  it('signs each PC prompt separately for both HTTP and legacy WS; never sends the credential', async () => {
    const signOrigin = vi.fn(async () => 'encoded.signature')
    vi.stubGlobal('window', { electronDesktop: { getSettings: vi.fn(), testConnection: vi.fn(), saveSettings: vi.fn(), signOrigin } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { commandId: 'cmd', status: 'accepted', duplicate: false } })))
    await createHttpCommandClient({ fetchImpl, getAccessToken: () => 'owner', subscribe: vi.fn() }).execute(command)
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ originProof: 'encoded.signature', clientMessageId: 'm' })
    const send = vi.fn()
    await createWsCommandClient({ send, subscribe: vi.fn() }).execute(command)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ originProof: 'encoded.signature' }))
    expect(signOrigin).toHaveBeenCalledTimes(2)
    expect(signOrigin).toHaveBeenCalledWith({ sessionId: 's', messageId: 'm' })
    expect(JSON.stringify(send.mock.calls)).not.toContain('privateKey')
  })

  it('keeps browser/mobile WS sends synchronous and origin-free', async () => {
    vi.stubGlobal('window', {})
    const send = vi.fn()
    const pending = createWsCommandClient({ send, subscribe: vi.fn() }).execute(command)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).not.toHaveProperty('originProof')
    await pending
  })

  it('accepts opaque origin proof but rejects client-supplied authoritative device IDs', () => {
    expect(parseSessionCommand({ ...command, originProof: 'encoded.signature' })).toMatchObject({ originProof: 'encoded.signature' })
    expect(() => parseSessionCommand({ ...command, originDeviceId: 'spoofed' })).toThrow('未知字段')
    expect(() => parseSessionCommand({ ...command, originProof: 'x'.repeat(4097) })).toThrow('过长')
  })
})
