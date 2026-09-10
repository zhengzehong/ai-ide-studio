import { getCaptureSettings, setCaptureSettings } from '../../model-capture/capture-config.js'
import type { RpcHandlerMap } from './types.js'

export const modelCaptureRpcHandlers: RpcHandlerMap = {
  'modelCapture.get'(msg, { sendResult }) {
    void msg
    sendResult(getCaptureSettings())
  },

  'modelCapture.set'(msg, { sendResult }) {
    const patch: { enabled?: boolean; retentionDays?: number } = {}
    if (msg.enabled !== undefined) {
      if (typeof msg.enabled !== 'boolean') throw new Error('enabled 必须是布尔值')
      patch.enabled = msg.enabled
    }
    if (msg.retentionDays !== undefined) {
      const days = Number(msg.retentionDays)
      if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
        throw new Error('保留天数必须是 1-365 的整数')
      }
      patch.retentionDays = days
    }
    sendResult(setCaptureSettings(patch))
  },
}
