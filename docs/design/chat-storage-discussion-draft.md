# 对话存储讨论稿：messages + turn_process_items

> 这是一份讨论稿，用来固定我们当前讨论出来的方向，方便继续评审。它不是实施清单，也不是最终迁移步骤。

## 1. 先把问题说清楚

现在对话卡顿和历史恢复不稳定，核心不是“前端样式问题”，而是数据边界不够清晰：

- `messages` 既放最终回复，又放很大的 `tool_calls_json`。
- `session_events` 按很细的 chunk / tool update 存，一轮复杂对话可以产生几千甚至上万条事件。
- 历史消息展开执行过程时，仍然依赖 raw event / raw tool JSON 还原，数据量容易失控。
- 文件修改摘要已经有 `file_changes_json`，但完整详情仍要从 `tool_calls_json` 里重新解析。

所以新的方向不是继续往 `messages.tool_calls_json` 和 `session_events` 里堆，而是把“最终消息”和“执行过程”拆清楚。

## 2. 讨论中的目标模型

保留两类核心数据：

```text
messages
turn_process_items
```

### 2.1 messages：对话主线

`messages` 只负责快速打开会话、展示用户输入和 Agent 最终回复。

它应该保存：

- 用户消息。
- Agent 最终回复。
- 附件摘要。
- 本轮状态：running / completed / failed / cancelled / interrupted。
- 本轮耗时、token、费用等轻量统计。
- 本轮是否有执行过程、工具调用、文件修改的轻量标记。
- 本轮文件修改轻量汇总，例如修改了几个文件、总增删行数。

它不应该继续承担：

- 完整工具输入输出。
- 大段 terminal output。
- 大段 diff。
- 每个 chunk 的流式事件。

### 2.2 turn_process_items：执行过程

`turn_process_items` 是一轮 Agent 回复里的执行过程列表。

它不是 raw event 表，而是“用户能看懂的过程块”。

一行代表一个逻辑块，例如：

- thinking：思考块。
- tool：工具调用块。
- file_change：文件修改块。
- permission：权限请求。
- elicitation：AI 提问 / 需要用户补充信息。
- plan：计划块。
- note：中间说明。
- usage：统计更新。
- error：错误。
- stage：正在准备 / 正在连接 / 正在执行 等生命周期状态。

建议字段口径：

```text
id
session_id
message_id
sequence
kind
status
title
summary
preview
content
detail_json
meta_json
created_at
updated_at
```

关键点：

- `sequence` 保证执行过程按真实发生顺序显示。
- 列表查询默认只取 summary / preview，不取大 detail。
- 用户点击某个块时，再按 item id 加载 `detail_json`。
- `session_events` 可以保留为 debug/raw 兜底，但不再作为 UI 历史恢复的主路径。

## 3. 最新一轮和历史消息的行为

### 3.1 当前正在执行的一轮

用户发消息后，前端马上出现：

```text
用户消息
Agent 消息：running
  <执行过程>
    正在准备 / 正在思考 / 工具调用 / 文件修改 ...
  </执行过程>
  最终回复流式输出
```

执行过程中新增什么块，就按时间顺序追加什么块，不要压平，也不要把工具调用统一挤到最后。

### 3.2 当前轮完成后

完成后：

- Agent 消息变成 completed。
- 最终回复留在主气泡正文。
- 执行过程默认折叠。
- 底部显示轻量统计：耗时、token、费用、修改文件 N 个。

### 3.3 历史消息

进入会话或切换回来时：

1. 先加载 `messages`，马上显示最终回复和轻量摘要。
2. 历史执行过程默认折叠，不主动加载大详情。
3. 用户点击“执行过程”时，加载 `turn_process_items` 的轻量列表。
4. 用户继续点击某个工具 / 文件修改块时，再加载该 item 的详情。

这样刷新页面、切换会话、不刷新长时间使用，都应该走同一套数据模型。

## 4. 文件修改怎么处理

### 4.1 文件修改会出现多少次

一次对话里文件修改可能出现很多次，要分三个层级看：

```text
Session：一个会话，包含多轮用户输入和 Agent 回复。
Turn / Message：一轮 Agent 回复，对应一条 Agent message。
File change item：这一轮执行过程中的一次文件修改块。
```

所以：

- 一个 Session 里可以有很多轮 Agent 回复，每轮都可能改文件。
- 一轮 Agent 回复里可以多次改文件，比如工具调用 A 改一次，工具调用 B 又改一次。
- 同一个文件在同一轮里也可能被多次修改。

展示口径应该是：

```text
执行过程：按真实顺序显示每一次文件修改块。
底部汇总：同一轮内按文件路径去重，只显示修改文件 N 个。
```

例如：

```text
执行过程
  工具调用 Edit A
  文件修改 src/a.ts
  工具调用 Edit B
  文件修改 src/a.ts, src/b.ts

底部汇总
  修改文件 2 个：src/a.ts, src/b.ts
```

### 4.2 现在文件修改是怎么存的

现在的实现大概是：

- 完整工具调用保存在 `messages.tool_calls_json`。
- 后端从工具调用内容里找 `content[].type = 'diff'`，生成轻量摘要。
- 轻量摘要保存在 `messages.file_changes_json`。
- 历史消息默认返回 `has_file_changes` / `file_change_count` / `file_changes_json` 这类轻量信息。
- 用户点击查看详情时，RPC `sessions.messageFileChanges` 重新读取这条消息的 `tool_calls_json`，再从里面解析完整 diff。
- 同时，细粒度过程还会存在 `session_events`，但这导致事件数量很大。

也就是说，当前完整文件修改详情的事实来源还是 `messages.tool_calls_json`，`file_changes_json` 只是摘要缓存。

这个方案短期能用，但问题是：

- `tool_calls_json` 会非常大。
- 文件修改详情和工具原始数据绑死。
- 要看 diff 就得解析整条工具 JSON。
- 长会话时 messages 表本身也会变重。

### 4.3 新方案里文件修改怎么存

新方案建议这样分：

#### messages 存汇总

`messages` 里继续保留轻量文件修改汇总，作为打开历史消息时的快速入口。

可以继续沿用 `file_changes_json`，内容只放轻量摘要：

```json
{
  "files": [
    { "path": "src/a.ts", "changeType": "M", "addedLines": 10, "deletedLines": 2 }
  ],
  "totalAdded": 10,
  "totalDeleted": 2
}
```

这个字段用于：

- 气泡底部显示“修改文件 N 个”。
- 历史消息不展开时也能知道有没有文件修改。
- 会话列表或后续任务总结快速统计。

它不是完整 diff 的存储位置。

#### turn_process_items 存过程和详情

每次运行中出现真实 ACP diff，就写入一个 `turn_process_items`：

```text
kind = file_change
message_id = 当前 Agent message id
sequence = 当前执行过程顺序
summary = 修改 2 个文件，+24 -8
preview = src/a.ts, src/b.ts
detail_json = 完整文件列表、多段 diff、关联 toolCallId
meta_json = runtime、toolCallId、来源等
```

`detail_json` 可以类似：

```json
{
  "files": [
    {
      "path": "src/a.ts",
      "changeType": "M",
      "addedLines": 10,
      "deletedLines": 2,
      "segments": [
        {
          "toolCallId": "tool-1",
          "oldText": "...",
          "newText": "...",
          "lines": []
        }
      ]
    }
  ]
}
```

这样：

- 执行过程能按顺序显示文件修改块。
- 底部汇总能从 `messages.file_changes_json` 快速显示。
- 点击历史文件修改详情时，只加载对应 `turn_process_items` 的详情，不需要解析整条 `tool_calls_json`。

### 4.4 工具块和文件修改块是否重复

这里要定一个口径：

- `tool` 块展示“调用了什么工具、输入输出摘要、状态”。
- `file_change` 块展示“这次工具调用实际报告了哪些 diff”。

如果一个工具调用带来了 diff：

```text
工具调用：filesystem.edit_file
文件修改：src/a.ts +10 -2
```

这不是重复，而是两层信息：一个是动作，一个是结果。

为了避免数据重复过大，建议：

- `tool` item 的详情里不再长期保存完整 diff，最多放 preview 或引用。
- 完整 diff 放在 `file_change` item 的 detail 里。
- `file_change.meta_json.toolCallId` 关联到对应工具块。

## 5. 为什么暂时一张 turn_process_items 表就够

之前提到过拆成 `turn_processes / tool_calls / tool_call_details` 多张表，但当前看会偏复杂。

现在真正需要的是：

- 按顺序显示执行过程。
- 历史默认轻量加载。
- 点击后加载某个块详情。
- 文件修改、权限、提问、工具调用都能用同一套机制展示。

这些用一张 `turn_process_items` 就能覆盖。

未来只有出现这些需求时，才考虑拆表：

- 要跨会话统计所有工具调用成功率。
- 要按工具名做复杂查询和报表。
- 要对大 diff / 大 terminal output 做对象存储或分片。
- 要做可靠回滚、checkpoint、文件审计。

在这些需求出现之前，单表更容易维护，也更不容易把 UI 恢复逻辑搞乱。

## 6. 运行中数据怎么落库

当前实现里，后端运行中有一份内存态：

```text
pendingBySession[sessionId]
```

它会累计当前轮的最终回复、thinking 和 toolCalls。每条 `session:update` 同时会被保存到 `session_events`。等 `session:done` 到来后，后端再把内存态合成一条 Agent `messages`，最后删除 `pendingBySession[sessionId]`。

这个机制短期能工作，但它有一个核心问题：**Agent 消息结束前，主消息表里没有完整的 running Agent message；刷新恢复主要依赖 session_events 或内存。**

新方案里不要等结束后才落库，建议改成：

```text
用户发送消息
  -> 写 human message
  -> 立即写 agent message，占位 status = running
  -> 后续流式更新 messages.content 快照
  -> 后续执行过程 upsert turn_process_items
  -> done 时 update agent message status = completed
```

也就是说，运行中也要有数据库事实来源：

- `messages` 里有当前正在运行的 Agent message。
- `messages.status = running`。
- `messages.started_at` 记录执行开始时间。
- `messages.content` 保存当前最终回复快照，可以节流更新。
- `turn_process_items` 保存当前已经出现的执行过程块。

后端内存仍然可以保留，但定位变成：

```text
内存 = 当前 turn 的聚合器 / 节流缓存
数据库 = 刷新、恢复、历史展示的事实来源
```

### 6.1 内存什么时候移除

运行中内存可以保存：

- 当前 final answer buffer。
- 当前 thinking buffer。
- 当前 toolCallId 到 tool item 的映射。
- 当前文件修改汇总。
- 当前最后一个 process sequence。

但这些数据不能只存在内存里。重要边界必须落库：

- 新工具调用出现。
- 工具状态变化。
- 出现 ACP diff。
- 出现权限请求。
- 出现 AI 提问。
- done / error / cancelled。

结束时：

```text
1. flush 内存里最后的数据
2. update messages.status
3. update messages.completed_at / elapsed / stats
4. update messages.file_changes_json 最终汇总
5. 把未完成的 process item 标记完成或中断
6. 删除内存 active turn
```

这样内存丢了不会影响已落库的可见状态。

### 6.2 不建议只结束后一次性写 turn_process_items

如果 `turn_process_items` 只在结束后写，会有几个问题：

- 刷新页面时看不到当前执行过程。
- 长任务执行中切换回来只能依赖内存。
- 服务重启或前端断线时，当前轮过程丢失。
- 权限请求 / AI 提问这种交互状态无法稳定恢复。

所以 `turn_process_items` 应该在运行中持续 upsert。

## 7. 前端刷新怎么还原

刷新页面后，前端不能依赖原来的浏览器内存，也不能指望 WebSocket 自动补齐过去的推送。

正确恢复流程应该是：

```text
页面打开
  -> 建立 WebSocket
  -> subscribe 当前 session
  -> 拉 sessions.messages
  -> 如果最新 Agent message.status = running
       拉这条 message 的 turn_process_items 轻量列表
       显示执行过程、最终回复快照、运行中状态
  -> 后续继续接收实时推送
```

### 7.1 刷新后 messages 要能说明当前状态

`sessions.messages` 返回历史消息时，最新 running Agent message 需要带这些轻量字段：

```text
id
session_id
role = agent
content = 当前最终回复快照
status = running
started_at
completed_at
has_process_items
process_item_count
file_changes_json
has_file_changes
file_change_count
decision_json / stats_json
```

前端看到 `status = running` 后，就知道这条不是普通历史消息，而是当前正在执行的一轮。

### 7.2 执行耗时怎么恢复

执行开始时间不要只放前端内存。

建议后端在创建 running Agent message 时写：

```text
started_at = now
```

前端刷新后用：

```text
当前时间 - messages.started_at
```

自己计算耗时，不需要后端每秒推送。

完成后再写：

```text
completed_at
elapsed_seconds
```

历史消息就显示固定耗时。

### 7.3 运行中需要推送什么

运行中 WebSocket 不应该推全量历史，只推增量或轻量快照。

建议分几类：

```text
session:activity
  表示 session running / idle，带 messageId、turnId、startedAt

session:update
  表示最终回复 contentDelta 或 content snapshot

session:process_item
  表示某个过程块新增或更新

session:done
  表示当前 Agent message 完成，带最终状态和统计摘要
```

其中 `session:process_item` 推轻量 item 即可：

```text
id
message_id
sequence
kind
status
title
summary
preview
updated_at
```

大字段 `detail_json` 不需要每次推给前端。用户展开某个工具或文件修改详情时，再按 item id 拉取。

### 7.4 推送和刷新之间怎么避免丢数据

WebSocket 推送只负责实时体验，数据库负责恢复。

前端刷新或断线重连时：

1. 先 subscribe。
2. 再拉一次当前 session snapshot。
3. snapshot 返回当前 message 和 process item cursor。
4. 后续收到推送按 `item.id` / `sequence` 去重合并。

这样即使刷新时漏掉几条推送，也能靠 snapshot 补回来。

### 7.5 服务重启后的兜底

如果服务重启时还有 `messages.status = running` 的消息，说明之前那轮可能异常中断。

启动时需要有兜底策略：

- 如果能恢复 ACP runtime，就继续标记 running。
- 如果不能恢复，就把这些 running message 标记为 interrupted / failed。
- 前端显示“本轮已中断，可重新发送或继续”。

不要让历史里长期留下一个永远 running 的消息。

## 8. 需要继续讨论的点

1. `messages.file_changes_json` 是继续沿用，还是改名成更通用的 `summary_json` / `stats_json`。
2. `file_change` item 是每个工具结果一个块，还是每个文件一个块。当前建议：每次工具结果一个块，块内包含多个文件。
3. `tool` item 是否完全不保存 diff，只保存引用到 `file_change` item。当前建议：完整 diff 只存一份，放 `file_change.detail_json`。
4. `session_events` 保留多久、是否开启 debug 开关、是否需要自动清理。
5. 历史迁移时，旧的 `messages.tool_calls_json` 如何转换为 `turn_process_items`。
6. 新增 `session:process_item`，还是继续复用 `session:update` 承载过程块更新。
7. running Agent message 的字段是直接加到 `messages`，还是放到 `decision_json / stats_json` 里。当前建议：状态和时间用显式字段，统计可以先放 JSON。
