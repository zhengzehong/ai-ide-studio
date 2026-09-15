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
  it('resumes auto-read after reset so the next conversation is not stuck unread', async () => {
    const control = new TeamReadControl()
    await control.markUnread(async () => {})
    const blocked = vi.fn(async (): Promise<void> => {})
    await control.read(blocked)
    expect(blocked).not.toHaveBeenCalled()
    // 切到另一条线（组件换 key/卸载）必须复位：否则新线永远不标已读，黄点再也消不掉。
    control.reset()
    const resumed = vi.fn(async (): Promise<void> => {})
    await control.read(resumed)
    expect(resumed).toHaveBeenCalledTimes(1)
  })
  it('drops the pending pointer on reset so a stuck read cannot block the next line', async () => {
    const control = new TeamReadControl()
    void control.read(() => new Promise<void>(() => {}))
    control.reset()
    const resumed = vi.fn(async (): Promise<void> => {})
    await control.read(resumed)
    expect(resumed).toHaveBeenCalledTimes(1)
  })
})
