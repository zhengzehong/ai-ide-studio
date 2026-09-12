import { describe, expect, it, vi } from 'vitest'
import { subscribeTeamRecovery } from '../../ui/src/components/team/team-chat-recovery'
import { TeamRecoveryGate } from '../../ui/src/components/team/team-chat-refresh'

describe('team recovery listeners', () => {
  function setup(): {
    emit: (message: Record<string, unknown>) => void
    document: EventTarget & { visibilityState: DocumentVisibilityState }
    load: ReturnType<typeof vi.fn<() => Promise<boolean>>>
    ack: ReturnType<typeof vi.fn>
    gate: TeamRecoveryGate
    stop: () => void
  } {
    let listener: (message: Record<string, unknown>) => void = (): void => {}
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const load = vi.fn<() => Promise<boolean>>().mockResolvedValue(false)
    const ack = vi.fn()
    const gate = new TeamRecoveryGate()
    const stop = subscribeTeamRecovery({
      client: { on: (_type, callback): (() => void) => { listener = callback; return (): void => { listener = (): void => {} } }, acknowledgeResync: ack },
      document, sessionIds: new Set(['master', 'member']), load, gate,
    })
    return { emit: message => listener(message), document, load, ack, gate, stop }
  }

  it('recovers PC snapshots for Master/member gaps and ignores unrelated sessions', async () => {
    const f = setup()
    f.emit({ sessionId: 'other' })
    expect(f.load).not.toHaveBeenCalled()
    f.emit({ sessionId: 'master' })
    f.emit({ sessionId: 'member' })
    expect(f.ack.mock.calls).toEqual([['master'], ['member']])
    expect(f.load).toHaveBeenCalledTimes(2)
    expect(f.gate.pending).toBe(true)
    f.stop()
  })

  it('retries when a gap arrives during an older load and releases listeners on exit', async () => {
    const f = setup()
    let finish: (result: boolean) => void = (): void => {}
    f.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.emit({})
    expect(f.ack).toHaveBeenCalledWith(undefined)
    expect(f.load).toHaveBeenCalledTimes(1)
    finish(true)
    await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2))
    f.stop()
    f.emit({ sessionId: 'master' })
    f.document.dispatchEvent(new Event('visibilitychange'))
    expect(f.load).toHaveBeenCalledTimes(2)
  })

  it('reloads on return to the foreground but never starts a followup after unmount', async () => {
    const f = setup()
    f.document.visibilityState = 'hidden'
    f.document.dispatchEvent(new Event('visibilitychange'))
    expect(f.load).not.toHaveBeenCalled()
    f.document.visibilityState = 'visible'
    f.document.dispatchEvent(new Event('visibilitychange'))
    expect(f.load).toHaveBeenCalledTimes(1)
    f.load.mockResolvedValue(true)
    f.emit({ sessionId: 'master' })
    f.stop()
    await Promise.resolve()
    expect(f.load).toHaveBeenCalledTimes(2)
  })
})
