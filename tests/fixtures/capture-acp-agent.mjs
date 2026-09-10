import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

let baseUrl = process.env.ANTHROPIC_BASE_URL
const runtime = process.env.CAPTURE_TEST_RUNTIME
const sessions = new Map()

async function dispatch(method, params) {
  if (method === 'initialize') return {
    protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { fork: {} } },
    authMethods: [],
  }
  if (method === 'authenticate') {
    baseUrl = params._meta.gateway.baseUrl
    return {}
  }
  if (method === 'session/new' || method === 'session/load' || method === 'session/fork') {
    // Exercise proxy access while the API is still awaiting the ensure/fork result.
    await requestModel('startup')
    const sessionId = params.sessionId ?? randomUUID()
    sessions.set(sessionId, 'test-model')
    return { sessionId, models: { currentModelId: 'test-model', availableModels: [{ modelId: 'test-model', name: 'test' }] } }
  }
  if (method === 'session/set_model') {
    sessions.set(params.sessionId, params.modelId)
    return {}
  }
  if (method === 'session/prompt') {
    await requestModel(sessions.get(params.sessionId))
    return { stopReason: 'end_turn' }
  }
  return {}
}

async function requestModel(model) {
  const path = runtime === 'codex' ? '/responses' : '/v1/messages'
  const result = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'fixture' }] }),
  })
  if (!result.ok) throw new Error(`Proxy returned ${result.status}: ${await result.text()}`)
  await result.text()
}

const input = createInterface({ input: process.stdin })
input.on('line', async (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  try {
    const result = await dispatch(message.method, message.params)
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } })}\n`)
  }
})
