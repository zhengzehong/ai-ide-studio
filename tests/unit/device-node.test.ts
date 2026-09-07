import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeCredentialStore, signNodeOrigin } from '../../electron/node/credential-store.js'
import { JobJournal } from '../../electron/node/job-journal.js'
import { NodeExecutor } from '../../electron/node/executor.js'
import { detectNodeShells } from '../../electron/node/shells.js'
import { executeNodeShell } from '../../electron/node/shell-executor.js'
import type { NodeResult, JobState } from '../../electron/node/types.js'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'node-test-')) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe('desktop execution node', () => {
  it('isolates credentials by server origin and does not store plaintext credentials', () => {
    const protector = { protect: (value: string): string => Buffer.from(value).toString('base64'),
      unprotect: (value: string): string => Buffer.from(value, 'base64').toString() }
    const store = new NodeCredentialStore(directory, 'https://server-a.test', protector)
    const keys = generateKeyPairSync('ed25519')
    const credential = { deviceId: 'd1', token: 'very-secret-token', enabled: true,
      privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
    store.save(credential)
    expect(store.load()).toEqual(credential)
    expect(new NodeCredentialStore(directory, 'https://server-b.test', protector).load()).toBeNull()
    const stored = readFileSync(join(directory, readdirSync(directory)[0]), 'utf8')
    expect(stored).not.toContain(credential.token)
    expect(stored).not.toContain('PRIVATE KEY')
    expect(signNodeOrigin(credential, 's', 'm')).toContain('.')
    expect(signNodeOrigin({ ...credential, enabled: false }, 's', 'm')).toBeUndefined()
  })

  it('does not re-execute an existing or unknown job after restart', async () => {
    const journal = new JobJournal(directory)
    const id = `djob-${randomUUID()}`
    journal.save({ id, state: 'running', result: {}, deadlineAt: Date.now() + 60_000, updatedAt: Date.now() })
    const frames: Record<string, unknown>[] = []
    const executor = new NodeExecutor(directory, {}, 'http://localhost', 'not-used', (frame) => frames.push(frame))
    executor.receive({ type: 'job.submit', jobId: id, request: { type: 'shell', command: 'never-run', timeoutSeconds: 60 } })
    expect(frames.at(-1)).toMatchObject({ type: 'job.state', state: 'unknown' })
    const missing = `djob-${randomUUID()}`
    executor.receive({ type: 'job.cancel', jobId: missing })
    expect(journal.get(missing)?.state).toBe('unknown')
    executor.receive({ type: 'job.submit', jobId: missing, request: { type: 'shell', command: 'never-run', timeoutSeconds: 60 } })
    expect(frames.at(-1)).toMatchObject({ state: 'unknown' })
    await executor.stop()
  })

  it('replays only missing log bytes and rejects path traversal IDs', () => {
    const journal = new JobJournal(directory)
    const id = `djob-${randomUUID()}`
    const frames: Record<string, unknown>[] = []
    journal.append(id, '中文', () => undefined)
    journal.append(id, 'tail', () => undefined)
    journal.replay(id, (frame) => frames.push(frame), Buffer.byteLength('中文'))
    expect(frames).toEqual([{ type: 'job.log', jobId: id, offset: 6, text: 'tail' }])
    expect(() => journal.get('../secret')).toThrow('ID')
  })

  it.runIf(process.platform === 'win32')('decodes UTF-8 and GB18030 and reports actual timeouts', async () => {
    const shell = detectNodeShells().powershell!
    for (const encoding of ['utf8', 'gb18030'] as const) {
      let text = ''
      let state: JobState | undefined
      const run = executeNodeShell({ executable: shell, request: { type: 'shell', command: "Write-Output '中文字符'", outputEncoding: encoding, timeoutSeconds: 10 },
        output: (value) => { text += value }, finish: (value) => { state = value } })
      await run.completion
      expect(state).toBe('succeeded')
      expect(text).toContain('中文字符')
    }
    let outcome: { state: JobState; result: NodeResult } | undefined
    const timed = executeNodeShell({ executable: shell, request: { type: 'shell', command: 'Start-Sleep -Seconds 30', timeoutSeconds: 1 },
      output: () => undefined, finish: (state, result) => { outcome = { state, result } } })
    await timed.completion
    expect(outcome?.state).toBe('timed_out')
  })

  it.runIf(process.platform === 'win32')('cancels a PowerShell child process tree', async () => {
    const shell = detectNodeShells().powershell!
    let output = ''
    let outcome: JobState | undefined
    const run = executeNodeShell({ executable: shell,
      request: { type: 'shell', timeoutSeconds: 15,
        command: '$p = Start-Process powershell.exe -ArgumentList "-NoProfile", "-Command", "Start-Sleep -Seconds 30" -WindowStyle Hidden -PassThru; Write-Output "CHILD=$($p.Id)"; Start-Sleep -Seconds 30' },
      output: (value) => { output += value }, finish: (state) => { outcome = state } })
    try {
      const deadline = Date.now() + 10_000
      while (!/CHILD=\d+\s/.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30))
      const childPid = Number(/CHILD=(\d+)/.exec(output)?.[1])
      expect(output).toMatch(/CHILD=\d+/)
      await run.cancel()
      expect(outcome).toBe('cancelled')
      expect(() => process.kill(childPid, 0)).toThrow()
    } finally { await run.cancel() }
  })

  it.runIf(process.platform === 'win32')('executes long scripts without exceeding the Windows command-line limit', async () => {
    let output = ''
    let outcome: JobState | undefined
    const run = executeNodeShell({ executable: detectNodeShells().powershell!,
      request: { type: 'shell', command: '#' + 'x'.repeat(23_000) + "\nWrite-Output '长命令完成'", timeoutSeconds: 10 },
      output: (value) => { output += value }, finish: (state) => { outcome = state } })
    await run.completion
    expect(outcome).toBe('succeeded')
    expect(output).toContain('长命令完成')
  })
})
