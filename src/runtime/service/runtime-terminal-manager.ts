import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { ResourceGovernor, ResourceLease } from '../resources/resource-governor.js'

interface RuntimeTerminal {
  process: ChildProcess
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode?: number | null
  signal?: string | null
  lease: ResourceLease
}

export class RuntimeTerminalManager {
  private readonly terminals = new Map<string, RuntimeTerminal>()

  constructor(private readonly resources: ResourceGovernor) {}

  async create(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    const lease = await this.resources.acquire('cpu')
    const terminalId = `term-${randomUUID().slice(0, 8)}`
    try {
      const process = spawn(params.command, params.args ?? [], {
        cwd: params.cwd ?? processCwd(),
        env: {
          ...globalThis.process.env,
          ...Object.fromEntries((params.env ?? []).map((item) => [item.name, item.value])),
        },
        shell: globalThis.process.platform === 'win32',
      })
      const terminal: RuntimeTerminal = {
        process,
        output: '',
        truncated: false,
        outputByteLimit: params.outputByteLimit ?? 200_000,
        lease,
      }
      this.terminals.set(terminalId, terminal)
      const append = (chunk: Buffer): void => this.appendOutput(terminal, chunk)
      process.stdout?.on('data', append)
      process.stderr?.on('data', append)
      process.once('exit', (code, signal) => {
        terminal.exitCode = code
        terminal.signal = signal
        terminal.lease.release()
      })
      return { terminalId }
    } catch (error) {
      lease.release()
      throw error
    }
  }

  output(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const terminal = this.terminals.get(params.terminalId)
    return {
      output: terminal?.output ?? '',
      truncated: terminal?.truncated ?? false,
      exitStatus: terminal && (terminal.exitCode !== undefined || terminal.signal !== undefined)
        ? { exitCode: terminal.exitCode ?? null, signal: terminal.signal ?? null }
        : null,
    }
  }

  async wait(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) return { exitCode: null, signal: null }
    if (terminal.exitCode !== undefined || terminal.signal !== undefined) {
      return { exitCode: terminal.exitCode ?? null, signal: terminal.signal ?? null }
    }
    return new Promise((resolve) => {
      terminal.process.once('exit', (exitCode, signal) => resolve({ exitCode, signal }))
    })
  }

  kill(params: acp.KillTerminalRequest): acp.KillTerminalResponse {
    this.terminals.get(params.terminalId)?.process.kill()
    return {}
  }

  release(params: acp.ReleaseTerminalRequest): acp.ReleaseTerminalResponse {
    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) return {}
    if (terminal.exitCode === undefined && terminal.signal === undefined) terminal.process.kill()
    terminal.lease.release()
    this.terminals.delete(params.terminalId)
    return {}
  }

  close(): void {
    for (const [terminalId] of this.terminals) this.release({ terminalId })
  }

  private appendOutput(terminal: RuntimeTerminal, chunk: Buffer): void {
    terminal.output += chunk.toString()
    if (Buffer.byteLength(terminal.output, 'utf8') <= terminal.outputByteLimit) return
    terminal.output = terminal.output.slice(-terminal.outputByteLimit)
    terminal.truncated = true
  }
}

function processCwd(): string {
  return globalThis.process.cwd()
}
