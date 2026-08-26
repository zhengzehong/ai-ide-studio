# PRD 数据保留与定时清理方案（简化首版）

## 目标

- 首期只治理占主库 90% 以上的 `session_events` 和 `turn_process_items`。
- 永久保留 `messages`、任务、知识库、项目等业务事实。
- 每个 Session 至少保留最近 15 个完成回合，并至少保留最近 7 天。
- Agent 整夜运行时照常清理，不要求所有 Prompt 停止。
- 不新增状态表，不清 Writer 幂等账本，首版保持简单。

## 当前占用

2026-08-26 只读统计：主库约 9.79 GB，WAL 约 16.5 MB。

| 数据组（含索引） | 物理页占用 | 主库占比 | 首期处理 |
|---|---:|---:|---|
| `session_events` | 4.75 GB | 48.50% | 清理 |
| `turn_process_items` | 4.13 GB | 42.22% | 清理 |
| `writer_batch_commits` | 416 MB | 4.25% | 暂不清理 |
| `runtime_commands` | 216 MB | 2.21% | 暂不清理 |
| `tool_call_audit` | 131 MB | 1.34% | 暂不清理 |
| `messages` | 65 MB | 0.66% | 永久保留 |
| `task_events` | 25 MB | 0.25% | 永久保留 |

`session_events + turn_process_items` 合计占主库约 90.72%。按最近 15 个完成回合模拟，约可清理 282 万条 event 和 18.3 万条 process item，payload 合计约 4.82 GB。

## 为什么不需要两张新表

### 不增加 `session_write_cursors`

该表只在清理 `writer_batch_commits` 时需要，用来保存 Session sequence 高水位。首版不清 Writer 账本，所以不需要改变现有游标逻辑。

### 不增加 `data_retention_jobs`

首版清理条件完全由永久保留的 `messages` 计算，每批 DELETE 都是幂等的：

- 进程中断时，已经删除的行不会再次出现；
- 下次运行重新从 `messages` 计算候选即可；
- 不需要持久化 phase、cursor 或 cutoff。

代价是中断后下一次运行会重新做候选查询，但数据库索引足以支撑，换取更小的实现和迁移风险。

## 回合定义

使用 `messages` 中成功完成的 Agent 消息作为唯一可清理回合事实：

```text
role = agent
status = completed
```

按 `session_id` 分组，以 `completed_at/timestamp` 倒序编号：

- `1-15`：保留详细事件和过程项；
- `>15` 且完成时间早于 7 天：允许删除详细事件和过程项；
- 当前 `running` Agent 消息：永远不进入候选。
- `failed/cancelled` Agent 消息：首版永久保留详细过程，便于排错。

不能用 `message.user` 计数，因为 Prompt batch 可能把用户消息、Agent 消息和定时消息合并成一个 ACP 回合。最终只产生一个终态 Agent message，因此按 Agent message 计数更准确。

## 清理内容

### `turn_process_items`

删除归属于旧 Agent message 的过程项，包括思考、工具、文件变化过程和阶段记录。

对候选消息先把 `messages.process_item_count` 置为 `0`，再分批删除过程项。这样清理期间前端不会加载到一半已删除、一半未删除的过程列表。历史消息正文、最终回答、`file_changes_json` 摘要仍在 `messages` 中。

### `session_events`

删除 `message_id` 指向旧 Agent message 的事件。占空间最大的 `tool.update`、`tool.call`、`thinking.chunk`、`message.chunk` 都属于这一类。

首版保留：

- `message_id` 为空的控制事件；
- 人类消息对应的低频 `message.user`；
- 无法明确归属 Agent message 的生命周期事件。

这些数据占比很小。保守保留可以避免为了极少空间引入复杂的 sequence cutoff 状态。

## 调度机制

清理窗口固定为北京时间 `02:00-06:00`：

- 服务持续运行：02:00 开始，06:00 停止并预约次日 02:00；
- 02:00 前启动：等待当天 02:00；
- 02:00-06:00 之间启动或重启：启动完成 1 分钟后加入当晚清理；
- 06:00 后启动：等待次日 02:00；
- 到 06:00 时不再申请新批次，正在执行的小批次完成后退出。

每轮结束后重新计算下一次 02:00，使用单次 `setTimeout`，避免固定 24 小时定时器因休眠产生漂移。

首版不要求 `activePromptCount=0`。清理循环与 Agent 工作并行：

1. 每秒向 Writer 发一个 background retention batch；
2. 每批默认最多删除 500 行；
3. Writer 在当前同步事务结束后执行该批删除，不会与正常写事务并发；
4. 单批目标控制在 20-50 ms；
5. 如果单批超过 100 ms，下一批自动减半；
6. 如果 Writer 请求出现超时或锁冲突，本轮暂停 30 秒后重试；
7. 只在 02:00-06:00 申请批次，剩余数据次日继续。

因此，即使 Agent 整晚运行，清理仍会穿插执行。影响是偶尔增加一个小批次的 Writer 延迟，而不是等待所有 Agent 停止后才清理。

## Writer 实现

新增一个专用 Worker operation：

```text
writer.retention.inspect  # dry-run 统计
writer.retention.batch    # 删除一个小批次
```

`writer.retention.batch` 不调用现有 `scheduler.drain()`。Writer Worker 本身是单线程：如果正常事务正在执行，retention 消息只能等事务结束；轮到 retention 时同步执行一个短 DELETE，然后事件循环继续处理正常写入。

清理 SQL 基于永久保留的 `messages`，不依赖已经删除的 event：

```sql
WITH completed_turns AS (
  SELECT id,
         session_id,
         COALESCE(completed_at, timestamp) AS completed_at,
         ROW_NUMBER() OVER (
           PARTITION BY session_id
           ORDER BY COALESCE(completed_at, timestamp) DESC, id DESC
         ) AS turn_rank
  FROM messages
  WHERE role = 'agent' AND status = 'completed'
), eligible AS (
  SELECT id
  FROM completed_turns
  WHERE turn_rank > 15 AND completed_at < @sevenDaysAgo
)
-- 每次仅删除 LIMIT @batchRows 对应的 rowid
```

候选消息和删除条件必须在 Writer 的同一个短事务内重新校验，不能由 API 先查 ID、稍后无条件删除。执行顺序：

1. 选中一个符合 `rank > 15 + completed + 7天前` 的候选 message；
2. 再次确认它不属于最近 15 回合、状态不是 running/failed/cancelled；
3. 把该 message 的 `process_item_count` 置零，立即关闭过程详情入口；
4. 分批删除该 message 的 `turn_process_items`，每批最多 500 行；
5. 分批删除该 message 的 `session_events`，每批最多 500 行；
6. 当前 message 两张派生表都清完后再选下一个；
7. 两类都无候选或到 06:00 时，本轮结束。

进程在任何步骤退出都没关系。下一次重新计算 eligible，继续删除剩余行。

## 删除后的用户可见结果

对第 16 个及更早、同时超过 7 天的成功回合：

| 内容 | 删除后 |
|---|---|
| 用户原始提问 | 保留，可查看 |
| Agent 最终回复 | 保留，可查看 |
| 消息状态、时间、耗时和统计 | 保留 |
| 图片/附件引用 | 保留 |
| 文件变更文件名和增删行摘要 | 保留 |
| 展示文件/预览记录 | 保留 |
| 思考过程 | 删除 |
| 工具调用名称、参数和输出详情 | 删除 |
| 逐阶段执行过程 | 删除 |
| 文件逐段 Diff 详情 | 删除，只保留摘要 |

`process_item_count=0` 仅表示该条老 Agent 消息没有可展开的执行过程，不会修改 `content/status/file_changes_json/presentations_json/stats_json`。聊天气泡仍使用 `messages.content` 展示最终回复。

当前 `sessions.messageFileChanges` 优先读取过程项，过程项不存在时只回退到旧 `tool_calls_json`，而新终态消息的 `tool_calls_json` 已经是 `NULL`。实现清理时需要补一个兼容回退：从 `messages.file_changes_json` 返回文件级摘要，并把 `segments` 返回为空数组。这样老消息点击文件变化不会报空，但明确不再展示逐行 Diff。

## 防误删约束

- 永远不执行 `DELETE FROM messages`；候选事实表只读。
- DML 必须在 Writer 内通过 `EXISTS` 重新校验 `role='agent'`、`status='completed'`、排名大于 15、完成超过 7 天。
- `running/failed/cancelled` 永不进入首版候选。
- 删除只允许命中候选 message ID 对应的 `turn_process_items` 和 `session_events.message_id`。
- 每批最多 500 行，不允许无 LIMIT 的历史大 DELETE。
- 首次使用 dry-run，输出各 Session 候选回合数、行数和字节，不输出消息正文。
- 正式开启前创建数据库备份；首晚核对删除前后 `messages` 总行数完全一致。
- 测试必须覆盖第 15/16 回合边界、恰好 7 天、running、failed、cancelled、多 Session、批次中断和重启后继续。

## 日志清理

当前 `data-prd/logs` 约 619 MB，其中单文件约 590 MB。现有 `pino-roll` 只有每日轮转，没有单文件大小上限。

首版修改：

- `frequency: daily`；
- `size: 100m`；
- 保留 14 个历史文件和 1 个活动文件；
- `removeOtherLogFiles: true`，清理旧进程留下的同前缀日志；
- `NODE_ENV=test` 不写 PRD 文件日志；
- PRD 推荐 `LOG_LEVEL=info`，显式配置仍优先。

日志轮转独立工作，不经过 SQLite Writer，也不受 Agent 是否运行影响。

## 暂不清理的数据

- `writer_batch_commits`：首版不动，因此不需要 Session cursor 新表。
- `runtime_commands`：首版不动。
- `tool_call_audit`：后续确认审计保留期再处理。
- `outbox_events`：当前全部 unpublished，不能自动删除，应单独排查。
- `messages`、任务、知识库、项目、Agent、设置：永久保留。
- `images/attachments`：没有引用扫描前不删除。
- `data-prd/tmp`：目前主要是人工诊断材料，不做整目录自动清理。

## 代码范围

生产代码预计新增或修改 9-12 个文件：

- 新增 `src/data-retention/retention-scheduler.ts`；
- 新增 `src/data-worker/writer-worker/retention.ts`；
- 修改 `WriteDataPort` 类型、Writer client 和 Worker entry；
- 修改 `app.ts`；
- 修改配置与 Edge config 透传；
- 增加一个索引 migration 及 migration 注册；
- 修改 `src/shared/logger.ts`。

测试新增或修改 4-6 个文件，覆盖回合边界、7 天窗口、运行中消息、批量上限、进程中断后重算、定时器和日志轮转。

预计总改动约 450-750 行，不涉及前端业务页面，属于中等改动。

## 发布步骤

1. 先以 `DATA_RETENTION_MODE=dry-run` 发布，只输出候选行数和估算字节。
2. 观察一轮 02:00-06:00 结果和 Writer 延迟。
3. 切换 `DATA_RETENTION_MODE=delete`，初始 batchRows 使用 500。
4. 观察 `writer.commit` P95/P99、retention 单批耗时和数据库 freelist。
5. 历史数据清完后，另约停服窗口执行一次 `VACUUM INTO`，让物理文件真正缩小。

日常 DELETE 只把页面变成可复用空间；当前 `auto_vacuum=0`，数据库文件不会自动缩小。

## 验收标准

- 最近 15 个终态 Agent 回合和当前运行回合的详细过程完整。
- 老消息正文、最终答案和文件变化摘要仍可查看。
- Agent 整夜运行时 retention 仍有进度。
- retention 单批不会造成 Writer timeout。
- 中途重启后下次可自动继续，不需要 job state。
- dry-run 与 delete 候选口径一致。
- 日志单文件控制在约 100 MB，测试不再污染 PRD 日志目录。
