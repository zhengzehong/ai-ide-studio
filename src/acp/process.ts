import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import type { AcpRequest, AcpResponse, AcpNotification, AcpInitializeResult } from './protocol.js'

export class AgentProcess extends EventEmitter {
  private proc: ChildProcess | null = null
  private buffer = ''
  private nextId = 1
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private _running = false

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string>,
  ) {
    super()
  }

  get isRunning(): boolean {
    return this._running
  }

  async start(): Promise<AcpInitializeResult> {
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env },
      shell: process.platform === 'win32',
    })

    this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk))
    this.proc.stderr!.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString())
    })

    this.proc.on('exit', (code) => {
      this._running = false
      this.emit('exit', code)
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`Agent 进程退出，退出码: ${code}`))
      }
      this.pendingRequests.clear()
    })

    this._running = true

    const result = await this.sendRequest('initialize', {
      protocolVersion: '2025-11-16',
      capabilities: {},
      clientInfo: { name: 'ai-ide-studio', version: '0.2.0' },
    })

    return result as AcpInitializeResult
  }

  async stop(): Promise<void> {
    if (!this.proc || !this._running) return
    try {
      await this.sendRequest('shutdown', {})
    } catch {
      // ignore
    }
    this.proc.kill()
    this._running = false
  }

  async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.proc?.stdin?.writable) {
      throw new Error('Agent 进程未运行')
    }

    const id = this.nextId++
    const request: AcpRequest = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`请求超时: ${method}`))
      }, 30000)

      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      this.proc!.stdin!.write(JSON.stringify(request) + '\n')
    })
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin?.writable) return
    const notification: AcpNotification = { jsonrpc: '2.0', method, params }
    this.proc.stdin.write(JSON.stringify(notification) + '\n')
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString()
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const msg = JSON.parse(trimmed)
        this.handleMessage(msg)
      } catch {
        this.emit('parse-error', trimmed)
      }
    }
  }

  private handleMessage(msg: AcpResponse | AcpNotification) {
    if ('id' in msg && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id as number)
      if (pending) {
        this.pendingRequests.delete(msg.id as number)
        const resp = msg as AcpResponse
        if (resp.error) {
          pending.reject(new Error(resp.error.message))
        } else {
          pending.resolve(resp.result)
        }
      }
    } else {
      this.emit('notification', msg)
    }
  }
}
