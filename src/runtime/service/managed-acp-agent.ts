import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { createChildLogger } from '../../shared/logger.js'
import type { AcpRuntimeClientRouter } from './acp-runtime-client.js'
import type { RuntimeGatewayAuth } from '../../acp/model-profile-env.js'

const log = createChildLogger('managed-acp-agent')

export interface ManagedAcpAgent {
  process: ChildProcess
  connection: acp.ClientSideConnection
  agentCapabilities?: acp.AgentCapabilities
}

export interface StartManagedAcpAgentInput {
  agentId: string
  runtime: string
  command: { cmd: string; args: string[] }
  cwd?: string
  env: NodeJS.ProcessEnv
  gatewayAuth?: RuntimeGatewayAuth
  router: AcpRuntimeClientRouter
  spawnProcess?: (command: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess
  createConnection?: (process: ChildProcess, router: AcpRuntimeClientRouter) => acp.ClientSideConnection
}

export async function startManagedAcpAgent(input: StartManagedAcpAgentInput): Promise<ManagedAcpAgent> {
  const spawnProcess = input.spawnProcess ?? spawn
  const process = spawnProcess(input.command.cmd, input.command.args, {
    cwd: input.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: input.env,
    shell: globalThis.process.platform === 'win32',
  })
  process.stderr?.on('data', (chunk: Buffer | string) => {
    const stderr = chunk.toString().trim()
    if (stderr) log.warn({ agentId: input.agentId, runtime: input.runtime, stderr: stderr.slice(0, 4_000) }, 'Agent runtime stderr')
  })
  const connection = input.createConnection?.(process, input.router) ?? createConnection(process, input.router)
  let spawnError: ((error: Error) => void) | undefined
  const failedToSpawn = new Promise<never>((_resolve, reject) => {
    spawnError = reject
    process.once('error', reject)
  })

  try {
    const initialized = await Promise.race([
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          auth: { _meta: { gateway: true } },
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          elicitation: { form: {}, url: {} },
        },
        clientInfo: { name: 'ai-ide-studio-runtime', version: '0.2.0' },
      }),
      failedToSpawn,
    ])
    if (input.gatewayAuth) {
      await connection.authenticate({
        methodId: input.gatewayAuth.methodId,
        _meta: {
          gateway: {
            baseUrl: input.gatewayAuth.baseUrl,
            providerName: input.gatewayAuth.providerName,
            headers: input.gatewayAuth.headers,
          },
        },
      })
    }
    if (spawnError) process.off('error', spawnError)
    log.info({
      agentId: input.agentId,
      runtime: input.runtime,
      contextWindow: parsePositiveInteger(input.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS),
      gatewayFingerprint: input.gatewayAuth?.fingerprint,
    }, 'Agent runtime initialized')
    return {
      process,
      connection,
      agentCapabilities: initialized.agentCapabilities ?? undefined,
    }
  } catch (error) {
    if (spawnError) process.off('error', spawnError)
    input.router.close()
    if (!process.killed) process.kill()
    log.error({ err: error, agentId: input.agentId, runtime: input.runtime }, 'Agent runtime initialization failed')
    throw error
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function createConnection(
  process: ChildProcess,
  router: AcpRuntimeClientRouter,
): acp.ClientSideConnection {
  if (!process.stdin || !process.stdout) throw new Error('Agent runtime stdio is unavailable')
  const stream = acp.ndJsonStream(
    Writable.toWeb(process.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>,
  )
  return new acp.ClientSideConnection(() => router.client, stream)
}
