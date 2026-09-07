import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NodeController } from '../../electron/node/controller.js'
import { NodeExecutor } from '../../electron/node/executor.js'
import { detectNodeShells } from '../../electron/node/shells.js'
import { executeNodeShell } from '../../electron/node/shell-executor.js'
import { createManagedLocalTarget } from '../../electron/desktop-target.js'

vi.mock('../../electron/node/shells.js', () => ({ detectNodeShells: vi.fn(() => ({})) }))
vi.mock('../../electron/node/shell-executor.js', () => ({ executeNodeShell: vi.fn() }))
const directory = mkdtempSync(join(tmpdir(), 'node-lifecycle-'))
afterEach(() => { vi.clearAllMocks(); rmSync(directory, { recursive: true, force: true }) })

describe('node lifecycle isolation', () => {
  it('does not detect shells or enable a managed-local desktop', async () => {
    const controller = new NodeController(createManagedLocalTarget(18800, 'unused', false), directory,
      { protect: (value: string): string => value, unprotect: (value: string): string => value })
    expect(detectNodeShells).not.toHaveBeenCalled()
    expect(controller.status()).toMatchObject({ supported: false, enabled: false, shells: [] })
    await expect(controller.setEnabled(true)).rejects.toThrow('Windows')
    await controller.close()
  })

  it('retains execution slots when a process tree could not be confirmed stopped', async () => {
    const finishes: Parameters<typeof executeNodeShell>[0]['finish'][] = []
    vi.mocked(executeNodeShell).mockImplementation((input) => {
      finishes.push(input.finish)
      return { cwd: directory, cancel: async (): Promise<void> => undefined, completion: Promise.resolve() }
    })
    const frames: Record<string, unknown>[] = []
    const executor = new NodeExecutor(directory, { powershell: 'test.exe' }, 'http://localhost', 'unused', (frame) => frames.push(frame))
    const submit = (): void => executor.receive({ type: 'job.submit', jobId: `djob-${randomUUID()}`,
      deadlineAt: Date.now() + 60_000, request: { type: 'shell', shell: 'powershell', command: 'test', timeoutSeconds: 60 } })
    submit()
    finishes[0]('unknown', { error: 'tree kill not confirmed' })
    submit()
    finishes[1]('unknown', { error: 'tree kill not confirmed' })
    submit()
    expect(executeNodeShell).toHaveBeenCalledTimes(2)
    expect(frames.at(-1)).toMatchObject({ state: 'failed', result: { error: '设备忙' } })
    await executor.stop()
  })
})
