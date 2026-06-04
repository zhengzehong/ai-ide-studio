import { timelineStore, timelineConfigStore } from '../../store/timeline.js'
import { refineTimeline, generateHistoricalTimeline } from '../../core/timeline.js'
import type { RpcHandlerMap } from './types.js'

export const timelineRpcHandlers: RpcHandlerMap = {
  'timeline.list'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('缺少 sessionId')

    const items = timelineStore.list(sessionId)
    sendResult(items)
  },

  async 'timeline.refine'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('缺少 sessionId')

    try {
      await refineTimeline(sessionId)
      sendResult({ ok: true })
    } catch (err) {
      sendError(err instanceof Error ? err.message : '整理失败')
    }
  },

  async 'timeline.generate'(msg, { sendResult, sendError }) {
    const sessionId = msg.sessionId as string
    if (!sessionId) return sendError('缺少 sessionId')

    try {
      await generateHistoricalTimeline(sessionId)
      sendResult({ ok: true })
    } catch (err) {
      sendError(err instanceof Error ? err.message : '生成失败')
    }
  },

  'timeline.config.get'(msg, { sendResult }) {
    const projectId = msg.projectId as string
    if (!projectId) {
      sendResult(null)
      return
    }
    const config = timelineConfigStore.get(projectId)
    sendResult(config ?? null)
  },

  'timeline.config.save'(msg, { sendResult, sendError }) {
    const projectId = msg.projectId as string
    if (!projectId) return sendError('缺少 projectId')

    const config = timelineConfigStore.upsert(projectId, {
      enabled: msg.enabled as number | undefined,
      provider_id: msg.providerId as string | undefined,
      model: msg.model as string | undefined,
      api_key: msg.apiKey as string | undefined,
      base_url: msg.baseUrl as string | undefined,
      trigger_interval: msg.triggerInterval as number | undefined,
    })
    sendResult(config)
  },
}
