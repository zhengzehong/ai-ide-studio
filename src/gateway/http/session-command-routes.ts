import type { Context, Hono } from 'hono'
import {
  RuntimeCommandConflictError,
  RuntimeCommandUnavailableError,
  type RuntimeCommandSubmission,
} from '../../commands/runtime-command-dispatcher.js'
import {
  MAX_SESSION_COMMAND_BYTES,
  parseSessionCommand,
} from '../../commands/session-command-types.js'
import { createChildLogger } from '../../core/logger.js'
import type { RuntimeCommandInput } from '../../ports/write-data-port.js'

const log = createChildLogger('gateway:http-command')

export interface SessionCommandDispatcherPort {
  submit(input: RuntimeCommandInput): Promise<RuntimeCommandSubmission>
}

export function mountSessionCommandRoutes(
  app: Hono,
  dispatcher: SessionCommandDispatcherPort,
): void {
  app.post('/api/v1/commands', async (c) => handleSessionCommand(c, dispatcher))
}

async function handleSessionCommand(
  c: Context,
  dispatcher: SessionCommandDispatcherPort,
): Promise<Response> {
  const startedAt = performance.now()
  const idempotencyKey = c.req.header('idempotency-key')?.trim()
  if (!idempotencyKey) return c.json({ error: '缺少 Idempotency-Key' }, 400)
  if (idempotencyKey.length > 256) return c.json({ error: 'Idempotency-Key 过长' }, 400)

  const contentLength = Number(c.req.header('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_SESSION_COMMAND_BYTES) {
    return c.json({ error: '命令请求体过大' }, 413)
  }

  try {
    const text = await c.req.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_SESSION_COMMAND_BYTES) {
      return c.json({ error: '命令请求体过大' }, 413)
    }
    const parsedJson = JSON.parse(text) as unknown
    const command = parseSessionCommand(parsedJson)
    const submission = await dispatcher.submit({
      commandId: command.commandId,
      idempotencyKey,
      type: command.type,
      sessionId: command.sessionId,
      projectId: command.type === 'prompt' ? command.contextProjectId : undefined,
      payload: command,
      createdAt: new Date().toISOString(),
    })
    const record = command.type === 'prompt'
      ? submission.command
      : await submission.completion
    const status = command.type === 'prompt' ? 202 : 200
    log.info({
      commandId: record.commandId,
      sessionId: record.sessionId,
      type: record.type,
      status: record.status,
      duplicate: submission.duplicate,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    }, 'HTTP Session command handled')
    return c.json({
      data: {
        commandId: record.commandId,
        status: command.type === 'prompt' ? 'accepted' : record.status,
        duplicate: submission.duplicate,
      },
    }, status)
  } catch (error) {
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2))
    const message = error instanceof Error ? error.message : '命令执行失败'
    if (message === '命令请求体过大') return c.json({ error: message }, 413)
    if (error instanceof SyntaxError) return c.json({ error: '命令 JSON 无效' }, 400)
    if (error instanceof RuntimeCommandConflictError || errorName(error) === 'RuntimeCommandConflictError') {
      return c.json({ error: message }, 409)
    }
    if (error instanceof RuntimeCommandUnavailableError || errorName(error) === 'RuntimeCommandUnavailableError') {
      return c.json({ error: message }, 503)
    }
    if (isValidationError(message)) return c.json({ error: message }, 400)
    log.error({ err: error, elapsedMs }, 'HTTP Session command failed')
    return c.json({ error: message }, 500)
  }
}

function errorName(value: unknown): string | undefined {
  return value instanceof Error ? value.name : undefined
}

function isValidationError(message: string): boolean {
  return message.includes('命令')
    || message.includes('必填')
    || message.includes('必须')
    || message.includes('不能为空')
    || message.includes('图片')
    || message.includes('未知字段')
}
