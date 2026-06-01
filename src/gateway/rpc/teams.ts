import { teamService } from '../../core/teams.js'
import type { RpcHandlerMap } from './types.js'

export const teamRpcHandlers: RpcHandlerMap = {
  'teams.current'(msg, { sendResult }) {
    const sessionId = msg.sessionId as string | undefined
    if (!sessionId) throw new Error('sessionId 不能为空')
    sendResult(teamService.currentBySession(sessionId))
  },
}
