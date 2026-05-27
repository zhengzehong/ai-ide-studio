import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import type { Server } from 'http'
import { WebSocketServer } from 'ws'
import type { AppConfig } from '../core/config.js'
import { handleWsConnection } from './ws-handler.js'
import { agentStore } from '../store/agents.js'
import { sessionStore } from '../store/sessions.js'
import { taskStore } from '../store/tasks.js'
import { ruleStore } from '../store/rules.js'

export async function startGateway(config: AppConfig) {
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok', uptime: process.uptime() }))

  app.get('/api/agents', (c) => c.json(agentStore.list()))
  app.get('/api/sessions', (c) => {
    const agentId = c.req.query('agentId')
    return c.json(sessionStore.list(agentId))
  })
  app.get('/api/tasks', (c) => {
    const status = c.req.query('status')
    return c.json(taskStore.list(status))
  })

  app.get('/api/rules', (c) => c.json(ruleStore.list()))

  const server = serve({ fetch: app.fetch, port: config.port }) as Server

  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => handleWsConnection(ws, req, wss))

  return { app, server, wss }
}
