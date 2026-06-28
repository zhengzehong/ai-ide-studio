# Agent 会话消息与 Watch 设计

## 背景

AI IDE Studio 已经有 Team 内部协作工具、事件中心、任务系统和普通会话。这里设计的是一套非 Team 的平台级 Agent 间通信机制，让任意两个 Agent 可以在平台层互相发消息、查看会话、必要时监听某个会话完成。

这套机制不替代 Team。Team 内部继续使用 Team 工具和 Team wake 逻辑。

## 当前版本决策

第一版不做统一 wake 表。

第一版直接使用 `sessionManager.enqueuePrompt()` 作为自动投递机制：

```text
业务记录落库
  -> 构造系统 prompt
  -> 后台调用 sessionManager.enqueuePrompt(targetSessionId, prompt)
  -> 工具调用立即返回排队结果，不等待目标 Agent 整轮完成
```

这样先解决最关键的问题：目标 session 正在生成时，自动消息不会直接失败，而是排队等当前轮结束后继续执行。

第一版暂不解决：

- 跨进程重启恢复未投递 wake。
- 所有自动触发来源的统一去重。
- 统一重试调度。
- 事件中心、任务系统、Team wake 的统一迁移。

这些放到后续 `session_wake_queue` 优化，不进入第一版实现范围。

## 目标

- 支持 A Agent 向 B Agent 发送平台消息。
- 支持消息直接投递到指定目标会话。
- 支持只指定目标 Agent，此时系统创建一个新目标会话，不复用最新会话。
- 支持动态关联信息，例如 `issue_id`、`task_id`、`event_id`、`file_path`、`commit_id` 等。
- 支持 `needReply`：要求目标 Agent 完成后主动用发送消息工具回传。
- 支持目标 Agent 没有回复时，系统在目标会话结束后补发一次提醒。
- 支持查看某个 Agent 的会话列表。
- 支持查看某个会话的最新消息。
- 支持 watch：监听某个会话完成后唤醒 watcher 所在会话。

## 非目标

- 不引入 `threadId`。
- 不引入 `reply` 工具。
- 不引入 `kind` 字段。
- 不引入 Agent 可见的 ack、标记已处理或手动确认机制。
- 不引入 `trigger_communication_id`。
- 不暴露 `agent_message_waits` 这类等待表给 Agent。
- 不把这套机制和 Team mailbox 混在一起。
- 不在只传 `targetAgentId` 时查找或复用最新可用会话。
- 第一版不新增 `session_wake_queue`。

## 数据模型

### `agent_session_messages`

平台层消息表建议命名为 `agent_session_messages`。含义是：一个来源 Agent 会话向一个目标 Agent 会话发送了一条消息。

建议字段：

```text
id
project_id
source_agent_id
source_session_id
target_agent_id
target_session_id
content
related_info_json
need_reply
reply_satisfied_at
reply_reminder_sent_at
reply_reminder_count
prompt_status
prompt_error
prompt_completed_at
created_at
updated_at
```

字段语义：

- `project_id`：系统根据当前工具上下文或会话上下文注入，Agent 不传。
- `source_agent_id`：系统根据当前工具上下文注入，Agent 不传。
- `source_session_id`：系统根据当前工具上下文注入，Agent 不传。
- `target_agent_id`：目标 Agent。
- `target_session_id`：目标会话。可以由 Agent 显式传入，也可以由系统新建。
- `content`：发送给目标 Agent 的正文。
- `related_info_json`：动态 JSON 对象，承载所有业务关联信息。
- `need_reply`：这条消息是否要求目标 Agent 主动回传。
- `reply_satisfied_at`：内部状态，用于判断 `needReply` 是否已被满足。
- `reply_reminder_sent_at`：系统补发提醒的时间。
- `reply_reminder_count`：系统补发提醒次数。第一版限制为最多 1 次。
- `prompt_status`：后台投递状态，建议取值 `queued`、`completed`、`failed`。
- `prompt_error`：后台投递失败原因。
- `prompt_completed_at`：`enqueuePrompt()` 后台 promise 完成时间。
- `created_at` / `updated_at`：创建和更新时间。

`related_info_json` 示例：

```json
{
  "issue_id": "ISSUE-017",
  "task_id": "task-123",
  "event_id": "evt-456",
  "file_path": "src/core/sessions.ts",
  "commit_id": "abc123",
  "note": "任何后续新增的关联字段都放这里"
}
```

### `agent_session_watches`

watch 不放进 `agent_session_messages`。它不是一条消息，而是一条监听关系。

建议字段：

```text
id
project_id
watcher_agent_id
watcher_session_id
watched_agent_id
watched_session_id
related_info_json
once
status
trigger_count
triggered_at
triggered_message_id
triggered_turn_id
last_error
cancelled_at
created_at
updated_at
```

字段语义：

- `watcher_agent_id`：创建 watch 的 Agent。
- `watcher_session_id`：创建 watch 的来源会话，也是触发后要被唤醒的会话。
- `watched_agent_id`：被监听会话所属 Agent，从 `watched_session_id` 派生。
- `watched_session_id`：被监听会话。
- `related_info_json`：动态关联信息。
- `once`：是否只触发一次。默认必须是 `1`。
- `status`：建议取值 `active`、`triggered`、`cancelled`、`failed`。
- `trigger_count`：触发次数。
- `triggered_at`：最近一次触发时间。
- `triggered_message_id`：触发时 `session:done` 携带的 message id。
- `triggered_turn_id`：触发时 `session:done` 携带的 turn id。
- `last_error`：触发后投递 watcher prompt 失败时记录。
- `cancelled_at`：取消时间。

## 工具定义

### `agent.message.send`

用途：向另一个 Agent 会话发送消息，并把消息作为系统 prompt 投递到目标 session。

Agent 可传参数：

```ts
{
  targetAgentId?: string
  targetSessionId?: string
  content: string
  relatedInfo?: Record<string, unknown>
  needReply?: boolean
}
```

系统注入字段：

```text
sourceSessionId
sourceAgentId
projectId
```

路由规则：

- 如果传了 `targetSessionId`：投递到该会话，并从会话记录派生 `targetAgentId`。
- 如果同时传了 `targetSessionId` 和 `targetAgentId`：必须校验二者匹配。
- 如果只传 `targetAgentId`：系统创建一个新 session，再投递消息。
- 如果两者都没传：拒绝调用。
- 如果目标会话和当前项目不匹配：拒绝调用。
- 如果目标 session 已关闭：拒绝调用。

执行规则：

```text
1. 校验 source session / source agent / project。
2. 解析或创建 target session。
3. 写入 agent_session_messages，prompt_status = queued。
4. 构造目标 prompt。
5. 后台调用 void sessionManager.enqueuePrompt(targetSessionId, prompt)。
6. 工具立即返回 messageId、targetSessionId、promptStatus。
7. 后台 promise 成功后更新 prompt_status = completed。
8. 后台 promise 失败后更新 prompt_status = failed，并写 prompt_error。
```

这里必须后台调用，不要在工具 handler 里 `await enqueuePrompt()`。否则 A Agent 调用 `agent.message.send` 时会卡到 B Agent 整轮执行结束。

### `agent.session.list`

用途：查看某个 Agent 的会话列表。

Agent 可传参数：

```ts
{
  agentId: string
  limit?: number
}
```

系统注入并约束：

- `projectId` 从当前上下文注入。
- 只返回当前项目内该 Agent 的会话。
- `limit` 默认建议 20。
- 返回字段以定位会话为主：`id`、`title`、`status`、`stage`、`started_at`、`last_message_at`、`activity_state`。

### `agent.session.messages`

用途：查看某个会话的最新消息。

Agent 可传参数：

```ts
{
  sessionId: string
  limit?: number
}
```

规则：

- `limit` 默认 10。
- 只返回该 session 的最近消息。
- 必须校验 session 属于当前项目可见范围。
- 返回字段建议包含：`id`、`role`、`content`、`status`、`timestamp`。
- 第一版不默认返回完整 tool raw input/output，避免上下文过大。

### `agent.watch.create`

用途：监听另一个会话的完成事件。被监听会话下次 `session:done` 后，系统唤醒 watcher 所在会话。

Agent 可传参数：

```ts
{
  sessionId: string
  once?: boolean
  relatedInfo?: Record<string, unknown>
}
```

系统注入字段：

```text
watcherAgentId
watcherSessionId
projectId
```

规则：

- `once` 默认必须是 `true`。
- 推荐只用于监听运行中的会话或第一次结果。
- 普通 A/B 通信场景优先使用 `agent.message.send` + `needReply`。
- 只能监听当前项目可见 session。
- watch 创建后只记录关系，不立即发 prompt。

### `agent.watch.cancel`

用途：取消当前 Agent 创建的 watch。

Agent 可传参数：

```ts
{
  watchId: string
}
```

规则：

- 只能取消当前 `watcher_session_id` / `watcher_agent_id` 创建的 watch。
- 不提供 ack 或标记已处理语义。

## Prompt 模板

### 普通消息投递 prompt

当 `needReply` 为 false 或未传时，投递给目标 session 的 prompt：

```text
[系统消息] 你收到了一条来自 AI IDE Studio 中其他 Agent 的消息。

来源 Agent：{sourceAgentName}（{sourceAgentId}）
来源会话：{sourceSessionId}
目标会话：{targetSessionId}

关联信息 JSON：
{relatedInfoJsonPretty}

消息内容：
{content}

请根据这条消息继续你的工作。
如果需要查看来源会话或相关上下文，可以使用 agent.session.messages 查询对应 session 的最近消息。
```

### 需要回复的消息投递 prompt

当 `needReply` 为 true 时，投递给目标 session 的 prompt：

```text
[系统消息] 你收到了一条来自 AI IDE Studio 中其他 Agent 的消息，并且这条消息需要你回复。

来源 Agent：{sourceAgentName}（{sourceAgentId}）
来源会话：{sourceSessionId}
目标会话：{targetSessionId}
平台消息 ID：{agentSessionMessageId}

关联信息 JSON：
{relatedInfoJsonPretty}

消息内容：
{content}

执行要求：
1. 先处理上面的消息内容。
2. 完成后必须调用 agent.message.send 回复来源会话。
3. 回复时 targetSessionId 必须使用 "{sourceSessionId}"。
4. 回复时 relatedInfo 建议沿用上面的关联信息 JSON。
5. 不要只在最终回答里说明结果；必须通过 agent.message.send 把结果发回来源会话。
```

目标 Agent 回传时示例：

```json
{
  "targetSessionId": "{sourceSessionId}",
  "content": "我已经处理完成，结论是……",
  "relatedInfo": {
    "issue_id": "ISSUE-017"
  }
}
```

### `needReply` 未回复提醒 prompt

当目标 session 结束后仍未满足 `needReply`，系统最多补发一次提醒：

```text
[系统提醒] 你刚才收到的一条 Agent 消息要求回复，但系统还没有检测到你调用 agent.message.send 回传结果。

来源 Agent：{sourceAgentName}（{sourceAgentId}）
来源会话：{sourceSessionId}
当前会话：{targetSessionId}
平台消息 ID：{agentSessionMessageId}

关联信息 JSON：
{relatedInfoJsonPretty}

原消息内容：
{content}

请现在调用 agent.message.send 回复来源会话。
调用要求：
- targetSessionId 必须使用 "{sourceSessionId}"。
- content 写清楚你的处理结果、结论、阻塞原因或需要对方继续的信息。
- relatedInfo 建议沿用上面的关联信息 JSON。
```

### Watch 触发 prompt

当 watch 监听的 session 完成后，投递给 watcher session 的 prompt：

```text
[系统消息] 你监听的 Agent 会话已经完成一轮执行。

被监听 Agent：{watchedAgentName}（{watchedAgentId}）
被监听会话：{watchedSessionId}
你的会话：{watcherSessionId}
Watch ID：{watchId}
触发消息 ID：{triggeredMessageId}

关联信息 JSON：
{relatedInfoJsonPretty}

你可以调用 agent.session.messages 查看被监听会话的最近消息：
sessionId = "{watchedSessionId}"

请根据该会话的最新结果决定是否继续处理。
```

## `needReply` 行为

`needReply` 不是阻塞等待，也不是暴露给 Agent 的 wait 表。

发送时：

1. A 调用 `agent.message.send`，传 `targetSessionId` 或 `targetAgentId`。
2. 系统写入 `agent_session_messages`。
3. 如果只传 `targetAgentId`，系统新建目标 session。
4. 系统构造“需要回复”的目标 prompt。
5. 系统后台调用 `sessionManager.enqueuePrompt(targetSessionId, prompt)`。
6. A 的工具调用立即返回，不等待 B 执行完成。

B 回复时：

1. B 调用 `agent.message.send` 发回 A 的 `sourceSessionId`。
2. 系统写入一条新的 `agent_session_messages`。
3. 系统查询是否存在未满足的反向 `needReply` 消息：

```text
source_session_id = 当前 targetSessionId
target_session_id = 当前 sourceSessionId
need_reply = 1
reply_satisfied_at IS NULL
```

4. 如果传了 `relatedInfo`，优先匹配关联信息相同或有重叠的记录。
5. 如果没有 `relatedInfo`，匹配最近一条未满足记录。
6. 命中后更新原消息的 `reply_satisfied_at`。

B 没回复但会话结束时：

1. 系统监听 `session:done`。
2. 查询该 session 作为 `target_session_id` 的未满足 `need_reply` 消息。
3. 只处理 `reply_reminder_count = 0` 的记录。
4. 更新 `reply_reminder_count = 1` 和 `reply_reminder_sent_at`。
5. 后台调用 `sessionManager.enqueuePrompt(targetSessionId, reminderPrompt)`。

## Watch 行为

watch 是“监听会话完成后唤醒我”，不是“发消息并等回复”。

创建时：

1. Agent 调用 `agent.watch.create({ sessionId })`。
2. 系统校验被监听 session 属于当前项目。
3. 系统写入 `agent_session_watches`，`status = active`。
4. 工具返回 `watchId`。

触发时：

1. 系统监听全局 `session:done`。
2. 找出 `watched_session_id = ev.sessionId` 且 `status = active` 的 watch。
3. 如果 `once = 1`，先把 watch 更新为 `triggered`，避免重复触发。
4. 如果 `once = 0`，保持 `active`，递增 `trigger_count`。
5. 构造 watch 触发 prompt。
6. 后台调用 `sessionManager.enqueuePrompt(watcherSessionId, prompt)`。

第一版的重复唤醒处理：

- 如果 A 对 B 创建了 watch，同时 A 又给 B 发了 `needReply` 消息，B 完成时可能出现两类唤醒：
  - B 如果已经用 `agent.message.send` 回复 A，则 A 会收到回复消息。
  - watch 也会尝试唤醒 A，提示 B 会话已完成。
- 第一版可做一个轻量抑制：触发 watch 前查询是否已经存在 `source_session_id = watchedSessionId` 且 `target_session_id = watcherSessionId` 的新消息。如果存在，并且创建时间晚于 watch 创建时间，则认为 Agent 回复已经承担通知作用，`once` watch 标记为 `triggered`，但不再投递 watch prompt。
- 这个抑制只解决 Agent 消息和 watch 的常见重复，不承诺解决所有自动来源去重。

## 现有链路分析

### 会话 prompt 串行化

当前所有真正进入 Agent 的内容最终都会走 `sessionManager.sendPrompt()` 或 `sessionManager.enqueuePrompt()`。

- `sendPrompt()`：用户或 RPC 主动发消息时使用。若 session 正在生成，会直接报“当前会话正在生成中”。
- `enqueuePrompt()`：自动唤醒类场景更适合使用。它会等待同一个 session 当前轮结束，再调用内部 `sendPromptNow()`。
- `sendPromptNow()` 会落库 human message、session event、running agent message，然后调用 ACP。

因此 Agent 间消息、`needReply` reminder、watch trigger 第一版都使用 `enqueuePrompt()`。

### 事件中心消费

事件中心当前有两种消费方式：

- `event.create` 创建事件后，系统根据订阅生成 `event_consumptions` 记录。
- `event.claim_next` 让 Agent 主动领取 pending consumption。
- `event-center.runConsumer` RPC 会 claim consumption，创建一个新 session，然后 fire-and-forget 调 `sessionManager.sendPrompt()`。

当前事件中心的 `auto_start` 字段已经存在于订阅表，但现有代码没有把 `auto_start` 接到自动唤醒执行链路上。`event-center:update` 只是 mitt 事件加 WebSocket 广播，用于 UI 刷新，不是后端 wake 队列。

### 任务创建和指派

任务创建/指派当前会在以下路径触发 Agent：

- `taskManager.createTask()`：如果传了 `assignAgentId`，会创建或复用 session，然后 fire-and-forget 调 `sessionManager.sendPrompt()`。
- `tasks.assign` RPC：会创建或复用 session，然后 fire-and-forget 调 `sessionManager.sendPrompt()`。
- `studio.task.create` / `create-task` 工具最终也会进入 `taskManager.createTask()`。
- 定时规则 `rules` 也可能创建任务或直接创建 session 并发送 prompt。

这些路径目前没有统一的持久化 wake 记录，也没有跨来源去重。第一版 Agent 通信不改这些旧链路。

### Team wake

Team 已经有独立 wake coordinator：

- 成员通过 mailbox 发 `report`、`result`、`question`、`blocked` 会 schedule Leader wake。
- 成员把任务更新为 `completed` 或 `blocked` 也会 schedule Leader wake。
- 该 coordinator 使用内存 `pendingByLeaderSession` 和 timer 做合并。
- flush 时使用 `sessionManager.enqueuePrompt()`，并监听 `session:done` / `session:manual-prompt-started` 避免抢占 Leader 当前轮。

Team wake 是 Team 专用逻辑。第一版 Agent 间通信不迁移 Team wake。

## 未来统一 wake 表

后续如果事件中心、任务系统、Team wake、Agent 间通信都要统一调度，再新增内部 `session_wake_queue`。

它要解决的是：

- 跨重启恢复 pending wake。
- 所有自动来源统一去重。
- 统一重试和失败可观测。
- 同一 target session 的自动 prompt 统一排队和调度。

未来表字段可以考虑：

```text
id
project_id
target_session_id
target_agent_id
source_type
source_id
dedupe_key
prompt
status
scheduled_at
attempt_count
last_error
created_at
updated_at
```

但这不是第一版必需项。第一版只在业务表中保留足够的状态字段，靠 `enqueuePrompt()` 完成投递串行化。

## 第一版实现边界

第一版只实现非 Team Agent 通信闭环：

- `agent_session_messages` 表和 store。
- `agent_session_watches` 表和 store。
- `agent.message.send`。
- `agent.session.list`。
- `agent.session.messages`。
- `agent.watch.create`。
- `agent.watch.cancel`。
- `needReply` prompt 注入。
- `session:done` 后一次 reminder。
- `session:done` 后 watch 触发。
- 所有自动投递都通过后台 `sessionManager.enqueuePrompt()`。

不做：

- 不实现 `session_wake_queue`。
- 不改造事件中心自动消费。
- 不改造任务创建/指派。
- 不改造 Team wake。

## 测试要求

后端单元/集成测试至少覆盖：

- `targetSessionId` 投递到指定会话。
- 只传 `targetAgentId` 时创建新 session。
- 同时传 `targetAgentId` 和 `targetSessionId` 时校验匹配。
- `relatedInfo` 原样落库。
- `agent.message.send` 工具立即返回，不等待目标 session 完成。
- `agent.message.send` 后台调用 `enqueuePrompt()`。
- `needReply` prompt 包含明确回复要求和来源 session。
- B 调用 `agent.message.send` 回 A 后，上一条 `needReply` 被满足。
- B session done 但未回复时，系统最多补发一次 reminder。
- reminder 也通过 `enqueuePrompt()` 投递。
- `agent.watch.create` 默认 `once = true`。
- watched session done 后唤醒 watcher session。
- once watch 只触发一次。
- watch 被取消后不触发。
- 当前项目外的 session/agent 不可访问。

## 结论

第一版可以不用 wake 表。Agent 间通信的核心对象是 `agent_session_messages`，watch 的核心对象是 `agent_session_watches`。自动投递统一使用后台 `sessionManager.enqueuePrompt()`，先把通信闭环跑通。

`session_wake_queue` 作为后续统一调度优化保留，但不进入第一版。
