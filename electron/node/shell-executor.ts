import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { powerShellScript, killOwnedProcessTree } from './shells.js'
import { createChildLogger } from './logger.js'
import type { NodeRequest, NodeResult, JobState } from './types.js'

export interface ShellRun { cwd: string; cancel(reason?: 'timeout'): Promise<void>; completion: Promise<void> }
const log = createChildLogger('shell')

export function executeNodeShell(input: {
  request: NodeRequest
  executable: string
  output: (text: string) => void
  finish: (state: JobState, result: NodeResult) => void
}): ShellRun {
  const requestedCwd = input.request.cwd || homedir()
  if (!isAbsolute(requestedCwd)) throw new Error('PC 工作目录必须是绝对路径')
  const cwd = realpathSync(requestedCwd)
  if (!statSync(cwd).isDirectory()) throw new Error('PC 工作目录不存在')
  if (typeof input.request.command !== 'string' || !input.request.command.trim() || input.request.command.length > 24_000) throw new Error('命令无效或过长')
  const scriptDirectory = mkdtempSync(join(tmpdir(), 'studio-node-shell-'))
  const scriptPath = join(scriptDirectory, 'command.ps1')
  const cleanupScript = (): void => {
    try { rmSync(scriptDirectory, { recursive: true, force: true }) }
    catch (err) { log.warn({ err }, '清理设备命令临时脚本失败') }
  }
  let child: ChildProcess
  let completed = false
  let cancelling: Promise<void> | undefined
  let cancellationReason: 'cancelled' | 'timed_out' | undefined
  let closedDuringCancel = false
  let resolveCompletion: () => void = () => undefined
  const completion = new Promise<void>((resolve) => { resolveCompletion = resolve })
  const stdout = new TextDecoder(input.request.outputEncoding ?? 'utf8')
  const stderr = new TextDecoder(input.request.outputEncoding ?? 'utf8')
  const done = (state: JobState, result: NodeResult): void => {
    if (completed) return
    completed = true
    clearTimeout(timer)
    cleanupScript()
    input.finish(state, { ...result, cwd })
    resolveCompletion()
  }
  try {
    writeFileSync(scriptPath, powerShellScript(input.request.command, input.request.outputEncoding), { encoding: 'utf8', mode: 0o600 })
    child = spawn(input.executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) { cleanupScript(); throw err }
  child.stdout?.on('data', (chunk: Buffer) => input.output(stdout.decode(chunk, { stream: true })))
  child.stderr?.on('data', (chunk: Buffer) => input.output(stderr.decode(chunk, { stream: true })))
  child.once('error', (error) => done('failed', { error: error.message }))
  child.once('close', (code) => {
    input.output(stdout.decode()); input.output(stderr.decode())
    if (cancellationReason) { closedDuringCancel = true; return }
    done(code === 0 ? 'succeeded' : 'failed', { exitCode: code })
  })
  const cancel = (reason?: 'timeout'): Promise<void> => {
    if (completed) return Promise.resolve()
    if (cancelling) return cancelling
    cancellationReason = reason === 'timeout' ? 'timed_out' : 'cancelled'
    cancelling = (async () => {
      const killed = child.pid ? await killOwnedProcessTree(child.pid) : false
      done(killed ? cancellationReason! : 'unknown', {
        ...(killed ? {} : { error: closedDuringCancel ? '主进程已退出，子进程树停止状态无法确认' : '未能确认进程树停止' }),
      })
    })()
    return cancelling
  }
  const timer = setTimeout(() => { void cancel('timeout') }, input.request.timeoutSeconds * 1000)
  return { cwd, cancel, completion }
}
