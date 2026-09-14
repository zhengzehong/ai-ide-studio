import { randomUUID } from 'node:crypto'

/**
 * 自治回合(后台唤醒)的共享约定。
 *
 * Claude Code 的 task-notification / peer / coordinator 等自治来源会驱动 CLI 在
 * "无平台 prompt"的状态下产生一整轮输出;平台侧把它合成为一个独立回合渲染落库,
 * 合成消息 id 统一带 auto- 前缀,核心/前端据此与真实 prompt 回合区分。
 */
export const AUTONOMOUS_TURN_MESSAGE_PREFIX = 'auto-'

/** ACP usage_update 帧上"该帧来自自治 result 终结"的 _meta 键(adapter 只在自治终结帧写入)。 */
export const AUTONOMOUS_ORIGIN_META_KEY = '_claude/origin'

/** 与 adapter AUTONOMOUS_RESULT_ORIGINS 同集合(acp-agent.js:67)。 */
export const AUTONOMOUS_ORIGIN_KINDS = [
  'task-notification',
  'peer',
  'coordinator',
  'observer',
  'observer-activity',
] as const

/**
 * 具备自治唤醒能力的 runtime 白名单。
 *
 * 自治回合(后台唤醒)的整套语义——task-notification 驱动、`_claude/origin` 终结帧、
 * 回合外内容转发——只有 claude 适配器实现;codex 没有任何自治唤醒机制(适配器内
 * task-notification/_claude/origin 零命中),其回合外帧只会是适配器诊断(如 MCP 启动
 * 失败转发)。非白名单 runtime 的无绑定帧一律不开启合成回合,避免启动时刻的
 * 假"运行中"与多余"[后台唤醒]"注记(生产实证 21/21 次误开全部来自 codex)。
 */
export const AUTONOMOUS_WAKE_CAPABLE_RUNTIMES: ReadonlySet<string> = new Set(['claude'])

/** 自治回合开始时的来源注记(作为 agent 内容发布,实时与历史重载都可见)。 */
export const AUTONOMOUS_TURN_NOTICE = '[后台唤醒] 由后台任务完成或系统通知触发的自主执行,以下为本回合内容。'

export function createAutonomousTurnMessageId(): string {
  return `${AUTONOMOUS_TURN_MESSAGE_PREFIX}${randomUUID()}`
}

export function isAutonomousTurnMessageId(messageId: unknown): boolean {
  return typeof messageId === 'string' && messageId.startsWith(AUTONOMOUS_TURN_MESSAGE_PREFIX)
}

/** 判断 usage_update 等帧的 _meta 是否携带自治来源标记(无 meta 的流中统计帧不算)。 */
export function hasAutonomousOriginMeta(meta: unknown): boolean {
  return typeof meta === 'object' && meta !== null && AUTONOMOUS_ORIGIN_META_KEY in (meta as Record<string, unknown>)
}