/**
 * 思考强度（effort）configOption 的统一匹配表 —— 服务端与 UI 共用，避免两边各写一套 id 列表。
 * ACP 不同适配器暴露的档位 id 不同：claude 适配器用 'effort'，部分 codex/第三方适配器用 'reasoning_effort'。
 * 写入侧必须先按此表在 capabilities.configOptions 里找到真实存在的 id，严禁对不存在的 configId 发写入
 * （codex 适配器会抛 invalidParams）。
 */
export const EFFORT_CONFIG_IDS = ['reasoning_effort', 'effort'] as const

/** 在 configOptions 里按统一优先级取档位项；不存在返回 undefined（调用方据此禁用档位开关）。 */
export function pickEffortOption<T extends { id: string }>(options: T[] | undefined): T | undefined {
  for (const id of EFFORT_CONFIG_IDS) {
    const hit = options?.find((option) => option.id === id)
    if (hit) return hit
  }
  return undefined
}
