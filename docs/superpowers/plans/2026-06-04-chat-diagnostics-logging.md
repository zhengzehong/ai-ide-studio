# 对话卡住诊断日志增强计划

目标：补齐后端日志可观测性，让“对话看起来卡住”时可以通过日志判断问题发生在 WS、Session、ACP、事件持久化、消息持久化还是广播阶段。

## 范围

- 修正 `LOG_DIR` 语义，避免 `logs/logs`。
- 启动时输出日志配置位置和级别。
- 每轮 prompt 增加 `turnId`，贯穿 Session 和 ACP 日志。
- 补 prompt 生命周期、`session:done`、`session:activity` 广播日志。
- 增加 active prompt watchdog，只告警不自动取消。
- 补 ACP update 摘要、`eventStore.append`、`messageStore.append` 的关键摘要日志。
- 更新 `AGENTS.md` 的日志路径与排查要求。

## 非目标

- 不修改对话 UI 渲染逻辑。
- 不修改 ACP 协议行为。
- 不把完整 prompt、图片 base64、工具 rawInput/rawOutput 写入普通日志。

## 实施步骤

1. 日志基础设施
   - `src/core/logger.ts` 导出日志路径/级别元信息。
   - `LOG_DIR` 显式设置时直接作为日志目录；未设置时使用 `DATA_DIR/logs` 或 `./data/logs`。

2. Prompt 诊断上下文
   - `sendPromptNow()` 创建 `turnId`。
   - 日志记录 human message、event sequence、ACP session、prompt start/done/error/cleanup。
   - 增加 watchdog 定时告警 active turn 的持续时间和最后一次进展。

3. ACP / 事件 / 消息摘要
   - `acpHost.prompt()` 接收可选 `turnId` 并记录 prompt lifecycle。
   - `client-handler` 对 ACP session update 打摘要日志。
   - `eventStore.append()` / `messageStore.append()` 记录摘要，不记录大字段正文。

4. WS 广播诊断
   - 记录 `session:done` / `session:activity` 广播目标数量。

5. 文档与验证
   - 更新 `AGENTS.md`。
   - 运行 `npm test`、`npm run build`、`npm run lint`、`git diff --check`。

## 验收标准

- 设置 `LOG_DIR=data-prd/logs` 时日志落在 `data-prd/logs/app*.log`，不会再出现 `logs/logs`。
- 一轮对话可以通过 `turnId` 搜到 prompt start、ACP prompt start/done、session done、activity idle。
- 卡住超过 watchdog 阈值会出现 warn 日志，包含 `sessionId/agentId/turnId/activeForMs/lastProgressAt`。
- 事件和消息持久化日志包含 `sequence/messageId/type/role/contentLength/toolCallCount` 等摘要。
