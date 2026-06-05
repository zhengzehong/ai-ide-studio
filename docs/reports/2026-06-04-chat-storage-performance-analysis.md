# 对话存储与历史加载问题分析

## 范围

本文基于当前仓库代码和 PRD 数据库现象，分析对话消息、执行过程、事件表、前端切换会话和 WebSocket 推送的现状与问题。

本文只做问题分析和重构方向说明，不是实施计划。

## 结论摘要

当前对话卡顿的核心原因不是 SQLite 本身，而是数据职责混在一起：

1. `session_events` 同时承担实时流、过程恢复、历史执行过程、调试日志等职责。
2. `session_events` 以 token / terminal delta 级别持久化，一轮真实编码任务可产生数千条事件。
3. `messages.tool_calls_json` 又保存完整工具调用 JSON，和 `session_events.payload_json` 形成大数据重复。
4. 前端切换会话时清空当前消息并重新请求 `messages` 与最近 1000 条 `events`，缺少真正的按 session 消息缓存。
5. 历史执行过程有懒加载机制，但入口和底层数据仍依赖大量 raw events，不适合作为长期 UI 主数据。

PRD 现场数据已经证明问题会放大：一个长期会话可超过 10 万条 `session_events`，单轮回复可超过 8000 条 event，单条 `messages.tool_calls_json` 可接近 10MB。

## 消息相关表

### `sessions`

会话元信息表，负责列表与状态展示：

- `id`
- `agent_id`
- `acp_session_id`
- `status`
- `stage`
- `title`
- `started_at`
- `last_message_at`
- `updated_at`

左侧会话列表主要依赖该表，以及实时广播的 `session:changed` / `session:activity`。

### `messages`

最终消息表，负责历史对话主展示。

一条用户输入一行，一条 Agent 最终回复一行。主要字段：

- `id`
- `session_id`
- `role`
- `content`
- `thinking`
- `tool_calls_json`
- `decision_json`
- `attachments_json`
- `file_changes_json`
- `timestamp`

现有问题：

- `tool_calls_json` 可能非常大，PRD 中已经出现 9MB~10MB 级别的单条 message。
- `messages` 与 `session_events` 都保存工具相关数据，存在重复。
- `messages` 适合做历史入口，不适合保存完整 raw 工具输出。

### `session_events`

过程事件表，负责记录实时过程事件。主要字段：

- `session_id`
- `agent_id`
- `acp_session_id`
- `message_id`
- `type`
- `role`
- `payload_json`
- `sequence`
- `created_at`

常见事件类型：

- `message.user`
- `message.chunk`
- `thinking.chunk`
- `tool.call`
- `tool.update`
- `usage.update`
- `message.done`
- `lifecycle.*`
- `permission.*`
- `elicitation.*`

现有问题：

- 事件粒度太细。一个 `message.chunk` 可能只是几个字，一个 `tool.update` 可能只是终端输出的一行或一小段。
- 每个事件都写 SQLite，一轮复杂任务会产生数千次写入。
- 事件表既用于恢复当前流式消息，又用于历史执行过程懒加载，还被用于无 `messages` 时的 timeline fallback，职责过多。

## 当前写入流程

### 用户发送消息

后端发送流程大致是：

1. 写入 `messages`：用户消息。
2. 写入 `session_events`：`message.user`。
3. 广播 `session:event`。
4. 广播 lifecycle 状态，例如“正在准备 Agent...”和“正在思考...”。
5. 调用 ACP runtime。

### Agent 流式更新

ACP runtime 产生 `session:update` 后，后端当前做两件事：

1. 将 update 转成 `session_events` 行并持久化。
2. 继续通过 WebSocket 推给前端。

这意味着流式 token 和工具输出既会实时推送，又会逐条入库。

### Agent 完成

收到 `session:done` 后：

1. 写入 `session_events`：`message.done`。
2. 将 pending turn 聚合为一条 Agent `messages` 记录。
3. `messages.content` 存最终回复。
4. `messages.tool_calls_json` 存完整工具调用数组。
5. 清理运行状态并广播完成。

现有问题：完成后 raw events 仍保留，完整工具调用也进入 `messages.tool_calls_json`，数据重复保留。

## 当前查询流程

### 历史消息查询

前端调用：

```text
sessions.messages { sessionId }
```

后端默认：

```text
messageStore.list(sessionId, limit = 100)
```

含义：

- 只返回最近 100 条 message。
- 后端支持 `before` 参数，但当前前端没有使用历史分页入口。
- 因此长会话超过 100 条后，前端历史消息会不全。

### 历史执行过程查询

历史执行过程当前是懒加载的，但不是完全理想。

前端条件：

```text
非 streaming
role = agent
存在 has_tool_calls
还没有 processBlocks
```

满足后，历史 Agent 气泡展示“执行过程”折叠入口。用户展开时调用：

```text
sessions.messageEvents { sessionId, messageId }
```

后端通过 `eventStore.listByMessage(sessionId, messageId)` 查该 message 关联的事件，再由前端按 `sequence` 还原执行过程块。

结论：

- 执行过程的展开是懒加载的。
- 但懒加载拿到的是 raw `session_events`，如果一轮有数千条事件，展开时仍然会很重。
- 如果一轮没有工具调用但有 thinking / note / lifecycle 过程，现有入口依赖 `has_tool_calls`，可能无法稳定展示历史执行过程入口。
- 工具详情还有二级懒加载：先取工具摘要，再点单个工具取详情。

### 会话切换时查询

当前 `selectSession(id)` 行为：

1. 保存旧会话的部分 UI cache。
2. `unsubscribe` 旧会话。
3. `subscribe` 新会话。
4. 清空 `messages`。
5. 用缓存恢复部分 `events / streamingMessage / usage / capabilities`。
6. 重新请求 `sessions.messages`。
7. 重新请求 `sessions.events { limit: 1000 }`。
8. 重新请求模型能力。

结论：

- 当前没有真正的 `messagesBySessionId` 缓存。
- 切回一个看过的会话也会重新拉 messages。
- `events` 有部分缓存，但仍会重拉最新 1000 条。
- 最新 1000 条 event 不是完整当前 turn；如果单轮超过 1000 event，会从中间恢复，导致显示截断。

### 渲染路径

`buildChatRenderItems()` 的核心规则：

- 如果当前 session 有 `messages`，则用 `messages` 生成气泡。
- 如果当前 session 没有 `messages`，则用 `events` 构造 timeline fallback。
- 如果存在当前 `streamingBubble`，则追加在末尾。

因此：

- 历史主显示走 `messages`。
- 在 `messages` 请求回来之前，可能短暂走 `events` fallback。
- 当前 streaming 追加在历史消息之后。

### 前端是否一次性渲染所有 message

当前前端会把本次返回的所有 `messages` 转成 `chatItems`。默认最多 100 条。

DOM 层有 `VirtualChatList`：

- `items.length <= 30` 时全部渲染。
- 超过阈值后只渲染可视区和 overscan。

结论：

- 数据层会一次性持有本次返回的全部 message。
- DOM 层对超过 30 条的列表做了虚拟滚动。
- 单条 message 内部如果包含很大的 process/tool 数据，虚拟滚动无法解决该气泡内部的重渲染问题。

## WebSocket 推送模型

### 连接模型

前端 `wsClient` 是单例。一个浏览器 tab 基本使用一个 WebSocket。

服务端为每个 WebSocket 保存：

```text
subscriptions: Set<sessionId>
```

切换会话时：

- 取消订阅旧 session。
- 订阅新 session。

### 订阅推送

以下事件只推给订阅该 session 的客户端：

- `session:update`
- `session:event`
- `session:done`
- `session:capabilities`

因此只有当前打开的会话会收到完整流式内容。

### 全局推送

以下事件广播给所有客户端：

- `session:activity`
- `session:changed`
- `agent:status`

它们用于更新左侧列表、运行中/未读状态和 Agent 状态。

### 当前风险

- 切走一个正在运行的会话后，前端不会继续接收该会话的完整内容流，只能切回来后从 DB 恢复。
- `session:update` 和 `session:event` 都会经过 WebSocket。前端对 mirrored realtime event 做了过滤，避免同一实时块重复驱动；但网络传输和 JSON parse 成本仍存在。
- 后台会话完成时，如果客户端未订阅该 session，不会收到 `session:done`，主要依赖全局 `session:activity` / `session:changed` 更新状态。

## 性能问题归因

### 数据爆炸

PRD 数据库现象：

- SQLite 文件约 250MB。
- `session_events` 超过 26 万行。
- 单个长期会话超过 10 万 event。
- 单轮 Agent 回复可超过 8000 event。
- 单条 `messages.tool_calls_json` 可接近 10MB。

根因：

- token delta 和 terminal delta 级别全部入库。
- tool raw output 被重复保存在 event 和 message 中。
- 完成后没有 compact / retention。

### 切换卡顿

根因：

- 切换会话时清空消息，导致 UI 必须等待重新请求。
- 每次切换都重新拉 `messages` 和最新 1000 `events`。
- `messages` 缺少按 session 的缓存和版本判断。
- `events` 不是历史主数据，却在切换时默认请求。

### 展开执行过程卡顿

根因：

- 历史执行过程懒加载是有的，但加载对象是 raw events。
- 一轮 raw events 可以有几千条，展开时要传输、parse、reduce、渲染。
- 工具输出和 file changes 的提取仍可能依赖大 JSON。

## 推荐重构方向

### 数据职责重新拆分

推荐长期模型：

```text
messages       = 轻量最终对话历史
turns          = 一轮 Agent 执行的状态、统计、最终 message 关联
turn_blocks    = UI 可渲染的执行过程块
tool_calls     = 工具调用摘要、状态、输入输出引用
session_events = 短期 raw 调试日志 / 当前执行恢复日志
```

### `messages`

只保留轻量历史：

- 用户内容
- Agent 最终回复
- 附件引用
- 统计摘要
- 是否有执行过程
- 执行过程数量
- 是否有文件变更

不再默认保存或返回完整 `tool_calls_json`。

### `turn_blocks`

保存 UI 需要的过程块：

- `thinking`
- `note`
- `tool`
- `stage`
- `permission`
- `elicitation`
- `plan`

粒度应是 UI 块，不是 token delta。

### `tool_calls`

一条工具调用一行，包含：

- server/tool 名称
- title
- status
- input 摘要
- output preview
- raw input/output 引用
- file change 摘要

raw output 大字段不直接塞进 `messages`。

### `session_events`

调整为：

- 当前执行中可保留 raw events 用于恢复。
- 完成后 compact 成 `turn_blocks` / `tool_calls`。
- raw events 可按配置保留最近 N 条或最近 N 天。
- Debug 模式可选择保留完整 raw log。

### 查询策略

推荐查询策略：

- 进入会话：只查 `messages` 轻量列表。
- 已完成历史：执行过程默认折叠，不查过程详情。
- 展开执行过程：查 `turn_blocks`，不是 raw events。
- 展开单个工具：查 `tool_calls` detail 或 raw blob。
- 当前执行中：用内存聚合流式状态，必要时查当前 turn 的完整聚合 blocks。
- 切换会话：先显示前端 cache，后台用 `last_message_at` / `version` 增量刷新。

### 前端缓存策略

推荐引入：

```text
messagesBySessionId
turnProcessByMessageId
toolSummariesByMessageId
toolDetailByToolCallId
sessionVersionBySessionId
```

切换回来：

1. 立即显示缓存 messages。
2. 如果 session `last_message_at` 没变，不重新拉 messages。
3. 如果变了，只增量拉新消息。
4. 默认不拉 events。
5. 当前执行中才恢复 active turn。

## 重构保护点

后续重构不能破坏以下行为：

- 用户发送后必须立即看到用户消息和 Agent 状态。
- 当前 Turn 流式过程必须按真实顺序显示。
- 当前 Turn 执行过程默认展开。
- 历史执行过程默认折叠并懒加载。
- 历史最终回复必须快速显示。
- 工具详情和 raw output 必须按需加载。
- 切换会话不能串消息、不能显示上一会话 streaming state。
- 刷新或服务重启后，已完成消息以 `messages` 为准，未完成执行以恢复/中断状态展示。
