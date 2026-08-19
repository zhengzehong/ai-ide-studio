import type { Context, Hono } from 'hono'
import {
  saveSessionFile,
  SessionFileUploadError,
} from '../../core/session-file-attachments.js'
import { createChildLogger } from '../../core/logger.js'
import { projectStore } from '../../store/projects.js'
import { sessionStore } from '../../store/sessions.js'

const log = createChildLogger('gateway:session-file-upload')

export function mountSessionFileUploadRoutes(app: Hono): void {
  app.post('/api/v1/session-files', handleSessionFileUpload)
}

async function handleSessionFileUpload(c: Context): Promise<Response> {
  const startedAt = performance.now()
  const projectId = c.req.query('projectId')?.trim() ?? ''
  const sessionId = c.req.query('sessionId')?.trim() ?? ''
  const fileName = c.req.query('name') ?? ''
  if (!projectId || !sessionId || !fileName) {
    return c.json({ error: '缺少 projectId、sessionId 或文件名' }, 400)
  }

  const project = projectStore.get(projectId)
  const session = sessionStore.get(sessionId)
  if (!project || !session) return c.json({ error: '项目或会话不存在' }, 404)
  if (session.project_id !== project.id) return c.json({ error: '会话不属于当前项目' }, 409)

  const contentLengthHeader = c.req.header('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined
  try {
    const saved = await saveSessionFile({
      projectId,
      sessionId,
      fileName,
      mimeType: c.req.header('content-type') ?? 'application/octet-stream',
      body: c.req.raw.body,
      ...(Number.isSafeInteger(contentLength) && (contentLength as number) >= 0
        ? { contentLength: contentLength as number }
        : {}),
    })
    log.info({
      projectId,
      sessionId,
      uploadId: saved.id,
      fileName: saved.name,
      size: saved.size,
      mimeType: saved.mimeType,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    }, 'Session file uploaded')
    return c.json({ data: saved }, 201)
  } catch (error) {
    const status = error instanceof SessionFileUploadError ? error.status : 500
    const message = error instanceof Error ? error.message : '文件上传失败'
    if (status === 500) {
      log.error({ err: error, projectId, sessionId, fileName }, 'Session file upload failed')
    } else {
      log.warn({ projectId, sessionId, fileName, status, message }, 'Session file upload rejected')
    }
    return c.json({ error: message }, status)
  }
}
