# 对话存储与执行过程重构实施方案

## 目标

基于 `docs/design/chat-conversation-behavior.md` 和 `docs/design/chat-storage-discussion-draft.md`，把当前对话链路从 `messages.tool_calls_json + session_events` 为主，改成：

```text
messages：对话主线、最终回复、运行状态、轻量汇总
turn_process_items：执行过程、工具、文件修改、权限、提问等过程块
```

目标不是改 UI 风格，而是修正数据边界，保证：

- 最新一轮实时流式输出稳定。
- 执行过程按真实顺序显示。
- 历史消息轻量加载。
- 文件 diff 详情按需加载。
- 刷新、切换会话、后台运行、服务重启后都能恢复到合理状态。

## Worktree 方案

本次改动应在单独 worktree 里做，不直接在当前 `master` 工作区开发。

建议：

```text
baseline_branch = master
feature_branch = feature/chat-storage-process-items
worktree_path = ../ai-ide-studio-chat-storage-process-items
```

创建前要求：

- 当前 `master` 的未提交改动需要先确认处理；不要把无关未提交文件带入 worktree。
- worktree 创建后写入 `.worktree-meta.json`。
- worktree 内独立 `npm install` / build / test。

## 后端实施方案

### 1. 数据模型

新增 `turn_process_items` 表。

建议字段：

```text
id TEXT PRIMARY KEY
session_id TEXT NOT NULL
message_id TEXT NOT NULL
sequence INTEGER NOT NULL
kind TEXT NOT NULL
status TEXT
title TEXT
summary TEXT
preview TEXT
content TEXT
detail_json TEXT
meta_json TEXT
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

索引：

```text
(message_id, sequence)
(session_id, message_id, sequence)
(session_id, kind, status)
```

扩展 `messages` 表，显式表达运行状态：

```text
status TEXT DEFAULT 'completed'
started_at TEXT
completed_at TEXT
stats_json TEXT
process_item_count INTEGER DEFAULT 0
```

`file_changes_json` 继续作为轻量汇总字段保留。

### 2. Store 层

新增专用 store，不把逻辑堆到 `src/store/sessions.ts`：

```text
src/store/turn-process-items.ts
```

核心方法：

```text
createRunningAgentMessage(sessionId, messageId, startedAt)
updateAgentMessageSnapshot(messageId, content, stats?)
completeAgentMessage(messageId, status, finalContent, stats, fileChangesSummary)

appendProcessItem(input)
upsertProcessItem(input)
listProcessItems(messageId, opts)
getProcessItemDetail(itemId)
completeOpenItems(messageId, status)
aggregateFileChanges(messageId)
```

原则：

- 列表查询默认不返回 `detail_json`。
- 详情查询按 item id 返回 `detail_json`。
- 文件修改汇总从 `file_change` items 聚合后写回 `messages.file_changes_json`。

### 3. 运行中落库

当前逻辑是 `pendingBySession` 内存累计，`session:done` 后才写 Agent message。

新逻辑改为：

```text
prompt received
  -> 写 human message
  -> 创建 running agent message
  -> active turn 内存只做聚合和节流

session:update
  -> 更新 active turn 内存
  -> upsert turn_process_items
  -> 节流更新 messages.content 快照
  -> 推送轻量实时事件

session:done
  -> flush active turn
  -> update messages.status = completed / failed / cancelled / interrupted
  -> update messages.completed_at / stats_json / file_changes_json
  -> complete open process items
  -> 删除 active turn 内存
```

### 4. ACP update 到 process item 的映射

新增映射模块，避免继续把映射逻辑散在 session/core/frontend：

```text
src/core/turn-process-mapper.ts
```

映射口径：

| 输入 | process item |
|------|--------------|
| lifecycle | `kind = stage` |
| thinking chunk | `kind = thinking` |
| message chunk 中被降级的中间说明 | `kind = note` |
| tool call/update | `kind = tool` |
| ACP diff | `kind = file_change` |
| permission request/result | `kind = permission` |
| elicitation request/result | `kind = elicitation` |
| plan update | `kind = plan` |
| usage update | 可进 `messages.stats_json`，必要时写 `kind = usage` |
| error | `kind = error` |

关键规则：

- 执行过程按 `sequence` 排序。
- 工具块显示工具行为。
- 文件修改块显示工具产生的 diff。
- 完整 diff 只放 `file_change.detail_json`，tool item 只保留引用或 preview。

### 5. WebSocket / RPC

保留现有实时体验，但增加面向新模型的 RPC。

新增或调整：

```text
sessions.messages
  返回轻量 messages，包括 status、started_at、completed_at、process_item_count、file_changes_json。

sessions.messageProcess
  { sessionId, messageId }
  返回这条 Agent message 的 process item 轻量列表，不返回 detail_json。

sessions.processItemDetail
  { sessionId, messageId, itemId }
  返回单个 process item 详情。

sessions.activeTurnSnapshot
  { sessionId }
  可选：返回当前 running message + process cursor，解决刷新和推送 race。
```

实时推送建议：

```text
session:activity
session:update            // final answer delta / content snapshot
session:process_item      // process item 新增或更新，轻量
session:done
```

如果为了少改协议，也可以先复用 `session:update` 承载 process item，但长期建议显式 `session:process_item`。

### 6. session_events 的定位

`session_events` 不再作为 UI 历史恢复主路径。

保留方式：

- 短期继续写，作为 debug / 兼容兜底。
- 前端正常历史不再 `fetchEvents(limit:1000)`。
- 迁移稳定后，再讨论是否给 `session_events` 增加 debug 开关、TTL 或压缩策略。

## 前端实施方案

### 1. Store 状态重构

`ui/src/stores/session.store.ts` 需要拆出或收敛过程状态，避免继续同时 reduce messages 和 events。

建议状态：

```text
messagesBySessionId
messageOrderBySessionId
processItemsByMessageId
processItemDetailById
activeTurnBySessionId
scrollStateBySessionId
```

当前页面只渲染 `currentSessionId` 的派生列表。

### 2. selectSession 行为

当前切换会话会清空再 fetch，容易闪烁和串状态。

新行为：

```text
selectSession(id)
  -> 保存旧 session 缓存和滚动位置
  -> subscribe 新 session
  -> 立即显示新 session 缓存
  -> 后台 fetch messages
  -> 如果最新 message.status = running，fetch messageProcess / activeTurnSnapshot
  -> 不再默认 fetchEvents(limit:1000)
```

### 3. 实时渲染

实时流式只走一个主通道，避免重复 reduce。

建议：

- `session:update` 只更新 active message 的 final answer content。
- `session:process_item` 更新 active message 的 process items。
- `session:done` 把 message 标为 completed，并默认折叠执行过程。
- `session:event` 不再驱动普通 UI；仅 debug 或兼容。

### 4. 历史执行过程懒加载

历史 Agent message 默认：

```text
最终回复
执行过程 · N 项 · 折叠
底部统计 / 文件修改摘要
```

点击执行过程：

```text
fetch sessions.messageProcess
渲染 process item 轻量列表
```

点击单个工具 / 文件修改：

```text
fetch sessions.processItemDetail
渲染 raw input/output 或 diff detail
```

### 5. 文件修改展示

前端展示口径：

- 实时过程中，`file_change` item 按顺序出现在执行过程里。
- 完成后，执行过程折叠。
- 底部显示 `messages.file_changes_json` 汇总。
- 历史详情点击后按 item 拉取完整 diff。

### 6. 自动滚动和性能

保留现有效果：

- 用户在底部附近时自动跟随。
- 用户上滚阅读时不强制打断。
- streaming 更新节流 50-100ms。
- ChatBubble / MarkdownRenderer / ProcessItem 组件 memo 化。
- 长会话不要一次性加载所有消息，支持分页加载更早消息。

## 兼容与迁移

### 旧数据读取

旧消息只有：

```text
messages.tool_calls_json
messages.file_changes_json
session_events
```

兼容策略：

- `sessions.messages` 仍能返回旧消息最终回复。
- 旧消息 `process_item_count` 可以从 `has_tool_calls` / `session_events` 估算。
- 旧消息展开执行过程时，短期可走旧的 `sessions.messageEvents` 兜底。
- 后续可以提供一次性迁移，把旧 `tool_calls_json` 转成 `turn_process_items`。

### 新数据写入

新 turn 必须写：

```text
running agent message
turn_process_items
messages.file_changes_json
```

`messages.tool_calls_json` 新数据不再作为主要存储，可为空或只保留兼容摘要。

## 测试方案

### 后端单元测试

新增/调整：

```text
tests/unit/turn-process-items.test.ts
tests/unit/file-changes.test.ts
tests/unit/turn-process-mapper.test.ts
```

覆盖：

- tool update upsert。
- thinking chunk 合并。
- file_change item 生成。
- 同一文件多次修改，过程保序，汇总去重。
- process item list 不返回 detail_json。
- detail RPC 返回单项详情。

### 后端集成测试

新增：

```text
tests/integration/chat-process-items.test.ts
tests/integration/chat-refresh-recovery.test.ts
```

覆盖：

- prompt 开始后立即有 running agent message。
- running 中刷新可从 DB 恢复 message + process items。
- done 后 message completed，process items 完成，内存清理。
- 历史 messages 默认轻量，不返回巨大 tool/diff raw。
- service restart 后 stale running message 被标记 interrupted 或可恢复。

### 前端单元测试

新增/调整：

```text
tests/unit/session-store-process-items.test.ts
tests/unit/chat-render-items.test.ts
tests/unit/session-store-recovery.test.ts
```

覆盖：

- selectSession 不串 session。
- 当前 running turn 刷新后恢复。
- `session:update` 和 `session:process_item` 不重复渲染。
- done 后执行过程默认折叠。
- 历史点击后才加载 process items。

### 浏览器验收

用 Playwright 或手工真实验证：

1. 简单问答：发送后立即显示用户消息、Agent 占位和流式回复。
2. 工具调用：执行过程按真实顺序显示 `note / tool / file_change / final answer`。
3. 文件修改：实时出现文件修改块，完成后底部显示修改文件数，点击可看 diff。
4. 长输出：历史消息不默认加载 raw output。
5. 切换会话：不串消息，切回 running 会话能恢复当前 turn。
6. 刷新页面：running turn 能恢复 started_at、过程块、最终回复快照。
7. 完成后：执行过程默认折叠，统计正常显示。
8. 失败/取消：状态明确，不无限转圈。
9. 模型/模式/图片：原有能力不回退。
10. 长会话：能加载更早消息，不固定只看最近 100 条。

## 验收命令

每轮关键改动后至少运行：

```bash
npm test
npm run build
npm run lint
git diff --check
```

前端真实验收：

```bash
npm run dev:all
```

然后打开工作台跑简单问答、工具调用、刷新恢复、切会话测试。

## 风险点

1. 运行中同时写 DB 和推 WS，容易重复渲染；前端必须按 item id / message id 去重。
2. 当前 `session_events` 还在写，迁移期不能让它继续驱动主 UI。
3. `message_id` 必须一轮唯一且稳定；不能 runtime chunk id 串轮。
4. 文件 diff 不能重复存到 tool detail 和 file_change detail 两份大 JSON。
5. 旧数据兼容不能阻塞新模型落地。
6. running message 如果服务重启后无法恢复，必须有 interrupted 兜底。

## 建议提交切分

建议拆成 4 个 commit：

1. 数据库迁移 + store + 后端测试。
2. 后端 runtime 落库链路 + RPC/WS + 集成测试。
3. 前端 store/cache/process item 渲染 + 前端测试。
4. 真实验收修复 + 文档同步。
