import WebSocket from 'ws'
import { resolve } from 'path'
import { loadConfig } from '../core/config.js'
import { initDatabase, getData } from '../store/db.js'
import type { AgentRow } from '../store/agents.js'
import type { TaskRow } from '../store/tasks.js'
import type { SessionRow } from '../store/sessions.js'
import type { RuleRow } from '../store/rules.js'

interface SimpleWsClient {
  request: (msg: Record<string, unknown>) => Promise<unknown>
  close: () => void
}

export async function getWsClient(): Promise<SimpleWsClient> {
  const config = loadConfig()
  const url = `ws://localhost:${config.port}`

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let counter = 0
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('连接超时'))
    }, 5000)

    ws.on('open', () => {
      clearTimeout(timeout)
      resolve({
        request(msg: Record<string, unknown>): Promise<unknown> {
          return new Promise((res, rej) => {
            const requestId = `cli-${++counter}`
            pending.set(requestId, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ ...msg, requestId }))
            setTimeout(() => {
              if (pending.has(requestId)) {
                pending.delete(requestId)
                rej(new Error('请求超时'))
              }
            }, 10000)
          })
        },
        close() { ws.close() },
      })
    })

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.requestId && pending.has(msg.requestId)) {
        const p = pending.get(msg.requestId)!
        pending.delete(msg.requestId)
        if (msg.type === 'error') p.reject(new Error(msg.message))
        else p.resolve(msg.data)
      }
    })

    ws.on('error', () => {
      clearTimeout(timeout)
      reject(new Error('无法连接到 Gateway'))
    })
  })
}

export function getDirectStore() {
  const config = loadConfig()
  const dbPath = resolve(config.dataDir, 'ai-ide.db')
  initDatabase(dbPath)
  const data = getData()

  return {
    agents: () => Object.values(data.agents) as AgentRow[],
    tasks: () => Object.values(data.tasks) as TaskRow[],
    sessions: () => Object.values(data.sessions) as SessionRow[],
    rules: () => Object.values(data.rules) as RuleRow[],
  }
}
