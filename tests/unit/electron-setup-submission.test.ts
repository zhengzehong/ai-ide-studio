import { describe, expect, test, vi } from 'vitest'
import { runDesktopSetupSubmission } from '../../electron/setup-submission.js'

describe('Electron setup submission', () => {
  test('reports a missing preload bridge instead of hanging', async () => {
    await expect(runDesktopSetupSubmission(undefined, {})).resolves.toEqual({
      ok: false,
      error: '桌面连接组件加载失败，请重新启动客户端',
    })
  })

  test('returns the main-process validation result', async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true })

    await expect(runDesktopSetupSubmission(submit, { mode: 'remote' })).resolves.toEqual({ ok: true })
    expect(submit).toHaveBeenCalledWith({ mode: 'remote' })
  })

  test('turns an IPC rejection into a visible error result', async () => {
    const submit = vi.fn().mockRejectedValue(new Error('IPC channel closed'))

    await expect(runDesktopSetupSubmission(submit, {})).resolves.toEqual({
      ok: false,
      error: 'IPC channel closed',
    })
  })

  test('returns a timeout when IPC never settles', async () => {
    vi.useFakeTimers()
    const pending = runDesktopSetupSubmission(() => new Promise(() => undefined), {}, 10_000)

    await vi.advanceTimersByTimeAsync(10_000)
    await expect(pending).resolves.toEqual({
      ok: false,
      error: '连接检查超时，请确认服务器地址后重试',
    })
    vi.useRealTimers()
  })
})
