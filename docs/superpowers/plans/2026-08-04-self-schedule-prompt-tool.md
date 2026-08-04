# AI 自用定时 Prompt 工具收敛

## 目标

将 AI 可见的 `studio.schedule.create` 收敛为“当前 Agent 在当前 Session 中创建定时 Prompt”能力，避免模型选择任务类型、Agent 或 Session 时误创建新会话。

## 改动范围

- 更新 `src/tools/seed.ts` 中 AI 暴露的 schema 和描述，仅保留 `name`、`cron`、`prompt`。
- 更新 `src/tools/handlers/schedule-tools.ts`：固定 `send_prompt`、当前 Agent、当前 Session、`session_mode=existing`，不读取旧的目标参数。
- 保留规则引擎、`rules.*` RPC、前端定时任务页面和数据库结构不变。
- 保留 `agent.wake_me` 的一次性唤醒语义。

## 验收标准

- `studio.schedule.create` 的 schema 只有 `name`、`cron`、`prompt` 三个必填字段。
- handler 在缺少 `agentId` 或 `sessionId` 的上下文时拒绝创建。
- 即使调用输入携带旧的 `action`、`agentId`、`sessionId`、`sessionMode` 或 `maxRuns`，也不会改变当前会话绑定，且新规则不设置最大执行次数。
- 创建的规则持久化为 `send_prompt` + `session_mode=existing`，目标为当前上下文。
- seed、handler 和回归测试通过；前端文件无改动。
