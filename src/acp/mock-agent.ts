import * as readline from 'readline'

const sessions = new Map<string, { messageCount: number }>()
let sessionCounter = 0

function sendResponse(id: number, result: unknown) {
  const msg = { jsonrpc: '2.0', id, result }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function sendNotification(method: string, params: unknown) {
  const msg = { jsonrpc: '2.0', method, params }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function sendError(id: number, code: number, message: string) {
  const msg = { jsonrpc: '2.0', id, error: { code, message } }
  process.stdout.write(JSON.stringify(msg) + '\n')
}

async function simulateStreamResponse(sessionId: string, prompt: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  session.messageCount++

  const messageId = `mock-msg-${Date.now()}`
  const thinkingText = `正在思考如何回答: "${prompt.slice(0, 50)}..."`
  const replyChunks = generateReply(prompt)

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'message_start',
  })

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'content_block_start',
    contentBlock: { type: 'thinking', thinking: thinkingText },
  })

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'content_block_stop',
    contentBlock: { type: 'thinking' },
  })

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'content_block_start',
    contentBlock: { type: 'text', text: '' },
  })

  for (const chunk of replyChunks) {
    await sleep(50 + Math.random() * 80)
    sendNotification('session/update', {
      sessionId,
      messageId,
      type: 'content_block_delta',
      delta: { type: 'text', text: chunk },
    })
  }

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'content_block_stop',
    contentBlock: { type: 'text' },
  })

  sendNotification('session/update', {
    sessionId,
    messageId,
    type: 'message_done',
  })
}

function generateReply(prompt: string): string[] {
  const lowerPrompt = prompt.toLowerCase()

  let fullReply: string
  if (lowerPrompt.includes('hello') || lowerPrompt.includes('你好')) {
    fullReply =
      '你好！我是 Mock Agent，一个用于测试的模拟 AI 助手。我可以响应你的消息，模拟真实 Agent 的流式回复行为。有什么可以帮你的吗？'
  } else if (lowerPrompt.includes('任务') || lowerPrompt.includes('task')) {
    fullReply =
      '收到任务指派！我正在分析任务需求...\n\n**任务理解：**\n我将按以下步骤执行：\n1. 分析需求和约束\n2. 设计解决方案\n3. 编写代码实现\n4. 测试验证\n\n正在开始第一步...'
  } else if (lowerPrompt.includes('重构') || lowerPrompt.includes('refactor')) {
    fullReply =
      '好的，让我来分析代码结构并提出重构方案。\n\n**分析结果：**\n当前代码存在以下可优化点：\n- 函数过长，需要拆分\n- 重复逻辑可以抽取\n- 类型定义不够严格\n\n我建议分三个阶段进行重构...'
  } else {
    fullReply = `收到你的消息: "${prompt.slice(0, 100)}"\n\n我是 Mock Agent，这是一条模拟回复。在实际使用中，这里会是真实 AI Agent（如 Claude、Codex）的回复。\n\n当前会话状态正常，流式传输工作正常。`
  }

  const chunks: string[] = []
  const words = fullReply.split('')
  let current = ''
  for (const char of words) {
    current += char
    if (current.length >= 3 + Math.floor(Math.random() * 5)) {
      chunks.push(current)
      current = ''
    }
  }
  if (current) chunks.push(current)

  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const rl = readline.createInterface({ input: process.stdin })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  let msg: { jsonrpc: string; id?: number; method: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return
  }

  if (!msg.method) return

  switch (msg.method) {
    case 'initialize': {
      sendResponse(msg.id!, {
        protocolVersion: '2025-11-16',
        capabilities: { streaming: true, tools: false },
        serverInfo: { name: 'mock-agent', version: '1.0.0' },
      })
      break
    }

    case 'shutdown': {
      sendResponse(msg.id!, {})
      setTimeout(() => process.exit(0), 100)
      break
    }

    case 'session/create': {
      const sessionId = `mock-session-${++sessionCounter}`
      sessions.set(sessionId, { messageCount: 0 })
      sendResponse(msg.id!, { sessionId })
      break
    }

    case 'session/prompt': {
      const sessionId = msg.params?.sessionId as string
      const content = msg.params?.content as string
      if (!sessions.has(sessionId)) {
        sendError(msg.id!, -1, `Session 不存在: ${sessionId}`)
        break
      }
      await simulateStreamResponse(sessionId, content)
      sendResponse(msg.id!, { accepted: true })
      break
    }

    case 'session/close': {
      const sid = msg.params?.sessionId as string
      sessions.delete(sid)
      sendResponse(msg.id!, {})
      break
    }

    default:
      sendError(msg.id!, -32601, `未知方法: ${msg.method}`)
  }
})
