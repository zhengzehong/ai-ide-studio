import { spawn } from 'child_process'
import type * as acp from '@agentclientprotocol/sdk'
import type { TerminalProcess } from './host-types.js'

const terminals = new Map<string, TerminalProcess>()

export function createTerminalProcess(terminalId: string, params: acp.CreateTerminalRequest, ourSessionId: string | undefined): acp.CreateTerminalResponse {
  const proc = spawn(params.command, params.args ?? [], {
    cwd: params.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...Object.fromEntries((params.env ?? []).map(item => [item.name, item.value])),
    },
    shell: process.platform === 'win32',
  })

  const term: TerminalProcess = {
    sessionId: params.sessionId,
    ourSessionId: ourSessionId ?? params.sessionId,
    proc,
    output: '',
    truncated: false,
  }
  terminals.set(terminalId, term)

  const appendOutput = (chunk: Buffer) => {
    term.output += chunk.toString()
    const limit = params.outputByteLimit ?? 200_000
    if (Buffer.byteLength(term.output, 'utf8') > limit) {
      term.output = term.output.slice(-limit)
      term.truncated = true
    }
  }
  proc.stdout?.on('data', appendOutput)
  proc.stderr?.on('data', appendOutput)
  proc.on('exit', (code, signal) => {
    term.exitCode = code
    term.signal = signal
  })

  return { terminalId }
}

export function terminalOutput(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
  const term = terminals.get(params.terminalId)
  return {
    output: term?.output ?? '',
    truncated: term?.truncated ?? false,
    exitStatus: term && (term.exitCode !== undefined || term.signal !== undefined)
      ? { exitCode: term.exitCode ?? null, signal: term.signal ?? null }
      : null,
  }
}

export async function waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
  const term = terminals.get(params.terminalId)
  if (!term) return { exitCode: null, signal: null }
  if (term.exitCode !== undefined || term.signal !== undefined) {
    return { exitCode: term.exitCode ?? null, signal: term.signal ?? null }
  }
  return await new Promise<acp.WaitForTerminalExitResponse>((resolve) => {
    term.proc.once('exit', (code, signal) => resolve({ exitCode: code, signal }))
  })
}

export function killTerminal(params: acp.KillTerminalRequest): acp.KillTerminalResponse {
  terminals.get(params.terminalId)?.proc.kill()
  return {}
}

export function releaseTerminal(params: acp.ReleaseTerminalRequest): acp.ReleaseTerminalResponse {
  const term = terminals.get(params.terminalId)
  if (term && term.exitCode === undefined && term.signal === undefined) term.proc.kill()
  terminals.delete(params.terminalId)
  return {}
}
