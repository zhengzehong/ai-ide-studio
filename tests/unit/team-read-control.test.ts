import { describe, expect, it, vi } from 'vitest'
import { TeamReadControl } from '../../ui/src/components/team/team-read-control'

describe('team unread action', () => {
  it('waits for in-flight auto-read before marking unread and pauses subsequent reads', async () => {
    const control = new TeamReadControl()
    let finish!: () => void
    const read = control.read(() => new Promise<void>(resolve => { finish = resolve }))
    const unread = vi.fn(async (): Promise<void> => {})
    const action = control.markUnread(unread)
    expect(unread).not.toHaveBeenCalled()
    const laterRead = vi.fn(async (): Promise<void> => {})
    await control.read(laterRead)
    expect(laterRead).not.toHaveBeenCalled()
    finish()
    await Promise.all([read, action])
    expect(unread).toHaveBeenCalledTimes(1)
    await control.read(laterRead)
    expect(laterRead).not.toHaveBeenCalled()
  })
  it('allows auto-read again when the unread action fails', async () => {
    const control = new TeamReadControl()
    await expect(control.markUnread(async () => { throw new Error('offline') })).rejects.toThrow('offline')
    const read = vi.fn(async (): Promise<void> => {})
    await control.read(read)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
