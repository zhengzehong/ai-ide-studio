# 数据模型

## 项目参谋配置

`project_advisors.advisor_prompt` 为空表示跟随服务端默认规则，非空表示用户自定义全文。`session_id` 引用独立参谋会话；启用开关不改变提示词模式。默认规则正文不是数据库快照。

`advisor_suggestions` 保留建议正文、状态、来源证据及接受后关联的任务。接受、建任务、忽略状态可进入后续分析的反馈摘要，已读不表示否定。批次归属与待分析变化属于内存运行态，服务重启后不逐条回放。

建议可见期限为 `min(expire_at, created_at + 24h)`，查询和派发占用共用该限制，因此历史七天期限无需迁移即可遵守新窗口。忽略后不在列表展示，反馈记录仍保留；已接受/建任务条目到期隐藏不撤销任务或删除其产物。忽略和派发通过状态及派发令牌条件互斥，批量忽略按项目和 ID 快照事务更新。反馈读取独立于页面的 24 小时展示窗口。

迁移 064 仅对已知历史默认全文的 SHA-256 匹配项恢复默认引用，并在 `settings` 的 `advisor_prompt_backup:064:<projectId>` 保存原文；自定义文本不覆盖。

## Project Inspiration

项目灵感配置还保存候选任务的默认执行 Agent、默认执行 Session 和目标优先级（`default`/`recommended`）。默认 Session 必须属于同一项目、同一 Agent 且保持 active。

项目灵感工作台使用三个持久化实体，均受 `project_id` 边界约束：

- `project_inspirations`：每个项目唯一的整理配置，保存当前长期灵感 Session、整理 Agent、提示词、自动整理开关和最近错误。
- `inspiration_notes`：保存不可依赖 AI 成功的原始 Markdown、图片附件清单、整理状态和当前结构化结果。`title_mode` 区分正文截断生成的自动标题与人工标题；`analysis_revision` 是已发布内容版本，`analysis_attempt_id` 与 `analysis_attempt_kind` 标识当前后台整理或交互修订轮次，`analysis_draft_json` 保存本轮尚未发布的完整草稿；`completed_at` 是独立于 AI 整理状态的人工完成标记。
- `inspiration_candidates`：保存某次整理版本生成的候选任务、推荐 Agent 和已创建 Task/执行 Session 的关联。`dispatch_token` 用于互斥创建，`task_id` 唯一约束保证一个候选最多转成一个 Task。

灵感原文先提交到 `inspiration_notes`，未填写人工标题时按正文连续原文生成最多 60 个字符的自动标题。后台整理和用户针对某条灵感的继续讨论共用项目长期 Session，并按项目串行执行。AI 先通过 `inspiration.note.get` 读取指定 Note；只有调用 `inspiration.analysis.publish` 才覆盖本轮草稿。Session 正常结束后，最后一份有效草稿原子提升为正式结果；没有发布、失败或服务重启只清理草稿，不覆盖已发布方案。人工可以单独标记完成或重新打开；编辑原文、重新整理或发布新方案会自动清除完成标记，普通讨论不发布方案时保持原标记。候选任务在用户确认前不进入 `tasks`；“只创建”生成 draft Task 和 pending Step，“立即执行”复用普通简单任务派发链路并创建独立执行 Session。历史候选按 revision 保留，但读模型只返回当前 revision。

## 实体关系

### reading_items

`reading_items` 是 PC 与 APP 共用的全局阅读清单，只保存来源和状态，不保存正文快照。项目、Session 或 Agent 删除后对应外键置空，阅读条目仍保留为未归类内容。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | `read-` 前缀的阅读条目 ID |
| project_id | TEXT | 来源项目；为空表示未归类 |
| session_id | TEXT | 来源会话，用于跳回讨论上下文 |
| agent_id | TEXT | 创建条目的 Agent |
| title | TEXT | 列表标题 |
| summary | TEXT | 服务端从本地文件头部或 URL 主机名提取的短摘要 |
| format | TEXT | `md` / `html` / `url` |
| mount_path | TEXT | MD/HTML 文件所在的 Gateway 本机目录；URL 条目为空 |
| entry_file | TEXT | MD/HTML 入口文件名；URL 条目为空 |
| url | TEXT | HTTPS 外部地址；MD/HTML 条目为空 |
| status | TEXT | `unread` / `read` / `archived` |
| created_at / updated_at | TEXT | 创建与最近状态更新时间 |
| read_at / archived_at | TEXT | 首次已读时间与当前归档时间 |

格式约束保证本地条目必须同时具有 `mount_path + entry_file` 且没有 URL，URL 条目必须只有 `url`。正文始终实时读取源文件或外部网页；源文件删除时元数据仍保留，客户端显示不可用状态。

```
Project 1:N Agent
Project 1:N Session
Project 1:N Task
Project 1:N Rule
Project 1:N Team
Project 1:N EventCenterEvent
AgentTemplate 1:N Agent
Agent 1:N Session
Agent 1:N TeamMember
Task  1:N Session
Task  N:1 Agent (assigned_agent_id)
EventCategory 1:N EventCenterEvent
EventCategory 1:N EventSubscription
EventCenterEvent 1:N EventConsumption
EventCenterEvent N:N Task (event_task_links)
Team  1:N TeamMember
Team  1:N TeamMailbox
Team  1:N TeamEvent
Team  1:N Task (tasks.team_id)
TeamMember 1:1 Session (current team session)
TeamMember 1:N Task (tasks.assignee_member_id)
Session 1:N Message
Session 1:N SessionEvent (append-only 事件溯源)
Session 1:N AgentSessionMessage (source/target)
Session 1:N AgentSessionWatch (watcher/watched)
Task    1:N TaskEvent
Project 1:1 KnowledgeBase (kind=project)
Project N:N KnowledgeBase (shared mounts)
KnowledgeBase 1:N KnowledgePage
KnowledgeBase 1:N KnowledgeActivity
KnowledgePage 1:N KnowledgeActivity
```

## 实体状态机

### Project

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Project ID |
| name | TEXT | 项目名称 |
| work_dir | TEXT | 本地工作目录 |
| description | TEXT | 项目描述 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### AgentTemplate

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 模板 ID |
| name | TEXT | 模板名称 |
| type | TEXT | 模板类型 |
| runtime | TEXT | claude / codex / mock |
| icon | TEXT | 图标 |
| system_prompt | TEXT | 系统提示词 |
| description | TEXT | 描述 |
| skills_json | TEXT | 技能列表 JSON |
| is_builtin | INTEGER | 是否内置 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### Agent Status

```
standby → running → standby
              ↓
           error → standby
```

### Session Status

```
active → idle → closed
           ↓
         closed
```

### Task Status

```
backlog → executing → reviewing → completed
              ↓           ↓
           blocked     backlog
```

### Event Status

```
pending → running → consumed → archived
   ↓          ↓          ↓
ignored     failed      task
```

## SQLite Schema

### agents

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Agent ID |
| type | TEXT | dev / test / ops / security / architect / pm |
| name | TEXT | 显示名称 |
| runtime | TEXT | mock / claude / codex |
| status | TEXT | standby / running / error |
| permission_level | INTEGER | 权限等级 (0-4) |
| config_json | TEXT | 运行时配置 JSON |
| created_at | TEXT | ISO 时间戳 |
| project_id | TEXT | 所属 Project；为空表示全局/兼容 Agent |
| template_id | TEXT | 来源 AgentTemplate；自定义 Agent 可为空 |
| system_prompt | TEXT | 项目级 Agent 的系统提示词 |
| icon | TEXT | UI 图标标识 |
| sort_order | INTEGER | 项目工作台 Agent 自定义排序；仅在项目作用域列表中生效 |
| hidden_at | TEXT | 项目工作台隐藏时间；为空表示在会话侧栏显示 |

`agents.config_json.autonomy` 保存自主开关、独立提示词、关注方向、当天排班、固定 Session/Rule ID 和最近运行状态。更新自主配置时必须与现有 `modelProfileId` 等 Agent 配置合并，不能覆盖同级字段。

### sessions

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Session ID |
| agent_id | TEXT FK | 所属 Agent |
| project_id | TEXT FK | 所属 Project |
| task_id | TEXT | 关联 Task（可选） |
| acp_session_id | TEXT | ACP 协议会话 ID |
| status | TEXT | active / idle / closed |
| stage | TEXT | 当前阶段描述 |
| title | TEXT | 会话显示标题（人工重命名或 ACP sessionInfo 自动补全） |
| started_at | TEXT | 开始时间 |
| updated_at | TEXT | 会话元数据更新时间 |
| last_message_at | TEXT | 最近消息时间 |
| last_read_at | TEXT | 最近确认已读时间；早于 `last_message_at` 时表示未读 |
| closed_at | TEXT | 关闭时间 |
| archived_at | TEXT | 归档时间 |
| deleted_at | TEXT | 软删除时间；非空时默认列表隐藏 |
| runtime_preferences_json | TEXT | Session runtime preferences JSON；保存 `modelId`、`modeId` 和 session config 选择 |
| sort_order | INTEGER | 项目工作台内同一 Agent 下 Session 自定义排序；仅在项目/Agent 作用域列表中生效 |
| is_primary | INTEGER | `1` 表示 Agent 的主会话；每个 Agent 最多一个未删除、非模板主会话 |
| is_template | INTEGER | `1` 表示模板内部 Session，不进入普通会话列表或主会话对账 |
| purpose | TEXT | `conversation` / `autonomy`；自主 Session 不进入普通 Workspace 列表 |

启动时默认 Agent seed 完成后，系统会为所有缺少主会话的 Agent 创建一个 `is_primary = 1` 的 Session，并发布完整 `session:changed`。部分唯一索引 `idx_sessions_one_primary_per_agent` 保证同一 Agent 不会存在两个未删除、非模板主会话；迁移旧数据库时保留最早一条 primary 标记并清理重复标记。

部分唯一索引 `idx_sessions_one_autonomy_per_agent` 保证同一 Agent 最多一个未删除、非模板的 `purpose = autonomy` Session。自主 Session 使用相同的消息、事件、运行偏好和 ACP 恢复结构，仅在展示和统计层与普通对话隔离。

进入会话通过 `sessions.markRead` 将 `last_read_at` 更新为当前时间。显式标记未读通过 `sessions.markUnread` 将其设置为最近消息时间前 1 毫秒，并发布 `session:changed(event=marked_unread)`；该状态继续由现有时间戳比较读取，不增加独立布尔列。Workspace 的 `sessions.bulkAction` 在同一项目和 Agent 作用域内批量更新多个会话的 `last_read_at`，或复用软删除流程写入 `deleted_at`；服务端按 `is_primary`、运行态和 `purpose` 保护不可批量删除的会话，并返回逐项成功/跳过结果。

### autonomy_reports

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 汇报 ID |
| project_id | TEXT | 所属 Project |
| agent_id | TEXT FK | 汇报 Agent |
| session_id | TEXT FK | 产生汇报的固定自主 Session |
| title | TEXT | 汇报标题 |
| summary | TEXT | 一句话摘要 |
| priority | TEXT | P0 / P1 / P2 / P3，仅作展示标签 |
| body_markdown | TEXT | GFM Markdown 正文，工具入口限制为 100 KiB |
| attachments_json | TEXT | 最多 20 个项目内相对文件路径和可选标题 |
| created_at | TEXT | ISO 时间戳 |

工作记忆不进入 SQLite，固定为 `DATA_DIR/autonomy/<projectId>/<agentId>/memory.md`。Runtime 只向对应自主 Session 的系统提示词注入绝对路径，Agent 使用既有文件读写能力维护；列表 RPC 只返回文件元数据，单 Agent 详情才读取最多 1 MiB 正文用于 PC 渲染。

### global_assistant

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 固定为 `default`，表示当前应用唯一全局助理绑定 |
| agent_id | TEXT FK | 全局助理使用的普通 Agent 实例 |
| session_id | TEXT FK | 全局助理复用的普通 Session |
| workspace_dir | TEXT | 全局助理专属工作目录 |
| enabled | INTEGER | 是否启用当前绑定 |
| created_at | TEXT | ISO 时间戳 |
| updated_at | TEXT | ISO 时间戳 |
| last_opened_at | TEXT | 最近打开时间 |

全局助理只保留一个活动绑定。它复用 `agents` 和 `sessions` 的既有运行时能力，但 `agents.project_id` 与 `sessions.project_id` 保持为空；创建或恢复 ACP Session 时，后端优先使用 `global_assistant.workspace_dir` 作为 runtime `cwd`。

### messages

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 消息 ID |
| session_id | TEXT FK | 所属 Session |
| role | TEXT | human / agent / system |
| content | TEXT | 消息文本 |
| thinking | TEXT | Agent 思考过程 |
| tool_calls_json | TEXT | 工具调用 JSON 数组 |
| decision_json | TEXT | 决策/统计 JSON |
| attachments_json | TEXT | 附件 JSON 数组 |
| file_changes_json | TEXT | ACP diff 文件变更轻量摘要 JSON |
| status | TEXT | completed / running / failed / cancelled |
| started_at | TEXT | Agent 消息开始生成时间 |
| completed_at | TEXT | Agent 消息完成时间 |
| stats_json | TEXT | 本轮 token / 费用 / 耗时等统计 JSON |
| process_item_count | INTEGER | 本轮执行过程块数量，用于历史消息折叠入口 |
| timestamp | TEXT | ISO 时间戳 |

历史消息查询默认返回轻量 DTO：`tool_calls_json` 会被置空，同时附带 `has_tool_calls` / `tool_call_count`、`process_item_count`、`has_file_changes` / `file_change_count`。新对话中，`messages.content` 是最终回复和运行中快照来源；完整执行过程不再依赖 `messages.tool_calls_json`，而是按顺序保存到 `turn_process_items`。旧消息的完整工具调用仍可通过工具摘要和详情 RPC 按需读取。

### turn_process_items

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 执行过程块 ID |
| session_id | TEXT FK | 所属 Session |
| message_id | TEXT FK | 所属 Agent 消息 |
| sequence | INTEGER | 单条 Agent 消息内的过程顺序 |
| kind | TEXT | stage / thinking / note / tool / file_change / permission / elicitation / plan / usage / error |
| status | TEXT | running / pending / completed / failed / cancelled 等 |
| title | TEXT | 展示标题 |
| summary | TEXT | 轻量摘要 |
| preview | TEXT | 列表预览文本 |
| content | TEXT | 轻量文本内容，例如 thinking/note/stage |
| detail_json | TEXT | 懒加载详情，例如工具 raw、权限请求、计划条目、完整 diff |
| meta_json | TEXT | 关联 ID 等元数据，例如 toolCallId/requestId |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

`turn_process_items.sequence` 是历史执行过程展示顺序的事实来源。列表查询默认不返回大 `detail_json`；用户点击某个过程块时再通过 `sessions.processItemDetail` 获取详情。ACP plan 更新保存为 `kind = plan`，权限和 AI 提问分别保存为 `permission` / `elicitation`，文件修改完整 diff 保存为 `file_change.detail_json`。消息表只保留文件级摘要，工具事件也只保留 diff 路径，避免在多个历史字段中重复保存完整旧文件和新文件。

### session_events

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 事件 ID |
| session_id | TEXT FK | 所属 Session |
| agent_id | TEXT | Agent ID |
| acp_session_id | TEXT | ACP 会话 ID |
| message_id | TEXT | 关联消息 ID |
| type | TEXT | 事件类型 |
| role | TEXT | 角色 |
| payload_json | TEXT | 事件载荷 JSON |
| sequence | INTEGER | 序号（单调递增） |
| created_at | TEXT | 时间戳 |



`session_events` 保留 raw/diagnostic 事件和旧数据兜底恢复能力。新对话的 UI 历史恢复优先使用 `messages` + `turn_process_items`，不再依赖按 chunk 还原整轮执行过程。单个 Agent Turn 使用平台生成的 Agent `message_id` 作为主消息 ID；runtime 提供的 chunk message id 不作为平台消息主键，避免不同 runtime 的 ID 复用导致串消息。

### writer_batch_commits

| 列 | 类型 | 说明 |
|----|------|------|
| batch_id | TEXT PK | Writer 幂等键；同一批次重试不重复执行 mutation |
| session_id | TEXT | 可选的 Session 排序作用域 |
| stream_generation | TEXT | Runtime 所有权代次 |
| first_sequence | INTEGER | 批次首个逻辑序号 |
| last_sequence | INTEGER | 批次最后逻辑序号 |
| committed_at | TEXT | 事务提交时间 |

同一 `session_id + stream_generation` 的新批次必须严格晚于最近已提交 `last_sequence`。新的 generation 可以重新从较小 sequence 开始。该表和业务 mutation 在同一事务写入，因此只有业务数据提交成功的 `batch_id` 才会被记录。

### outbox_events

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Outbox 事件 ID |
| topic | TEXT | 领域主题，例如 `session.done` |
| aggregate_type | TEXT | 聚合类型 |
| aggregate_id | TEXT | 聚合 ID |
| project_id | TEXT | 可选 Project 作用域 |
| session_id | TEXT | 可选 Session 作用域 |
| version | INTEGER | 聚合事件版本 |
| payload_json | TEXT | 可序列化领域载荷 |
| created_at | TEXT | 创建时间 |
| published_at | TEXT | 成功发布到 Realtime 后的时间；未发布为 NULL |
| attempts | INTEGER | 发布尝试次数 |

关键领域状态与 Outbox 行由 Writer Worker 在同一事务提交。高频 token delta 不写 Outbox；当前首个接入事件为 `session.done`。后续 Realtime 独立进程按 `published_at IS NULL` 顺序投递和确认。

### runtime_commands

| 列 | 类型 | 说明 |
|----|------|------|
| command_id | TEXT PK | 浏览器生成的命令 ID |
| idempotency_key | TEXT | HTTP `Idempotency-Key`；与 `type` 组成唯一约束 |
| type | TEXT | prompt / session.cancel / sessions.markRead / sessions.markUnread / permission.respond / elicitation.respond |
| session_id | TEXT | Session FIFO 作用域 |
| project_id | TEXT | Prompt 的可选临时项目上下文 |
| payload_json | TEXT | 通过封闭 DTO 校验后的命令载荷 |
| status | TEXT | accepted / running / completed / failed / interrupted |
| attempts | INTEGER | 进入 running 的执行次数 |
| error | TEXT | failed/interrupted 原因 |
| created_at | TEXT | 接收时间 |
| updated_at | TEXT | 最近状态变更时间 |

Command dispatcher 只执行已经由 Writer 提交为 accepted 的行。同一 `type + idempotency_key` 重试返回原命令；载荷或 Session 不一致视为冲突。API 启动按 `(created_at, command_id)` 游标分页扫描全部 accepted/running 行：未落用户消息的 Prompt 可恢复，已落用户消息的 running Prompt 标记 interrupted，避免重复对话。

### agent_session_messages

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Agent 会话消息 ID |
| project_id | TEXT | 所属 Project；为空表示全局/兼容会话 |
| source_agent_id | TEXT | 来源 Agent ID |
| source_session_id | TEXT | 来源 Session ID |
| target_agent_id | TEXT | 目标 Agent ID |
| target_session_id | TEXT | 目标 Session ID |
| content | TEXT | 投递给目标 Agent 的消息内容 |
| related_info_json | TEXT | 动态关联信息 JSON，例如 issue/task/event/file 等业务 ID |
| need_reply | INTEGER | 是否要求目标 Agent 主动回传 |
| reply_satisfied_at | TEXT | 反向回复被检测到的时间 |
| reply_reminder_sent_at | TEXT | 未回复提醒发送时间 |
| reply_reminder_count | INTEGER | 未回复提醒次数；当前最多一次 |
| prompt_status | TEXT | queued / completed / failed |
| prompt_error | TEXT | 后台投递失败原因 |
| prompt_completed_at | TEXT | 后台 `enqueuePrompt()` 完成时间 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

`agent.message.send` 先写入该表，再后台调用 `sessionManager.enqueuePrompt(target_session_id, prompt)`。只传 `targetAgentId` 时会创建新的目标 Session；`source_*` 与 `project_id` 来自 MCP tool context。

### agent_session_watches

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Watch ID |
| project_id | TEXT | 所属 Project；为空表示全局/兼容会话 |
| watcher_agent_id | TEXT | 创建 watch 的 Agent ID |
| watcher_session_id | TEXT | 创建 watch 并接收唤醒的 Session ID |
| watched_agent_id | TEXT | 被监听 Session 所属 Agent ID |
| watched_session_id | TEXT | 被监听 Session ID |
| related_info_json | TEXT | 动态关联信息 JSON |
| once | INTEGER | 是否只触发一次，默认 1 |
| status | TEXT | active / triggered / cancelled / failed |
| trigger_count | INTEGER | 触发次数 |
| triggered_at | TEXT | 最近触发时间 |
| triggered_message_id | TEXT | 触发时 `session:done` 的消息 ID |
| triggered_turn_id | TEXT | 触发时 `session:done` 的 turn ID |
| last_error | TEXT | 投递 watcher prompt 失败原因 |
| cancelled_at | TEXT | 取消时间 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

watch 监听 `session:done`，触发后后台唤醒 `watcher_session_id`。如果被监听 Session 已经向 watcher Session 发过 Agent 会话消息，watch 会记录触发但抑制重复唤醒。

### knowledge_bases

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 知识库 ID |
| name | TEXT | 显示名称 |
| kind | TEXT | project / shared；project 绑定单个项目，shared 可被多个项目挂载 |
| src | TEXT | manual / code；code 页面可记录源文件指纹并检测陈旧 |
| icon | TEXT | 展示图标 |
| description | TEXT | 描述 |
| project_id | TEXT | kind=project 时的项目 ID；shared 为空 |
| index_page_id | TEXT | 索引页 ID |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |
| deleted_at | TEXT | 软删除时间；本期不提供删库入口 |

每个项目通过唯一索引保证只有一个未删除的 `kind=project` 知识库。项目可见知识 = 项目库 + 已挂载的 shared 库。

### knowledge_pages

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 页面 ID |
| kb_id | TEXT | 所属知识库 |
| title | TEXT | 页面标题 |
| title_norm | TEXT | 标题归一化值，用于 `[[标题]]` 解析和唯一约束 |
| section | TEXT | 页面分组 |
| summary | TEXT | 页面摘要 |
| body | TEXT | Markdown 正文 |
| author | TEXT | human / ai |
| by | TEXT | 最后写入者 ID 或标签 |
| tags_json | TEXT | 标签 JSON 数组 |
| is_index | INTEGER | 是否索引页 |
| src_files_json | TEXT | code 页面关联的源文件路径数组 |
| src_fingerprint_json | TEXT | 源文件 sha256/size/mtime 指纹 |
| stale | INTEGER | 源文件变化后标记为 1，刷新后清 0 |
| last_human_edit_at | TEXT | 最近人工编辑时间；AI 刷新覆盖前需要显式确认 |
| last_activity_id | TEXT | 最近写入活动 ID |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |
| deleted_at | TEXT | 软删除时间 |

页面以 `(kb_id, title_norm)` 在未删除范围内唯一。Wikilink 解析在当前项目可见知识库范围内查找目标；跨库重名用 `[[库名/标题]]` 消歧。

### knowledge_mounts

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 挂载 ID |
| project_id | TEXT | 使用 shared 库的项目 |
| kb_id | TEXT | 被挂载的 shared 知识库 |
| created_by | TEXT | 操作者 |
| created_at | TEXT | 创建时间 |
| deleted_at | TEXT | 卸载时间 |

挂载只改变项目可见范围，不复制页面，也不删除 shared 库内容。仅 `kind=shared` 的知识库可进入挂载关系。

### knowledge_activities

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 活动 ID |
| kb_id | TEXT | 知识库 ID |
| page_id | TEXT | 页面 ID；库级活动可为空 |
| act | TEXT | create / edit / delete / refresh / revert / mount / unmount / create_kb |
| actor | TEXT | human 或 Agent ID |
| actor_type | TEXT | human / ai / system |
| tool | TEXT | 写入来源；AI 写入为 `core.kb.*`，人工写入为 manual |
| note | TEXT | 操作备注 |
| prev_body | TEXT | 旧正文兼容字段 |
| prev_snapshot_json | TEXT | 写入前页面快照 |
| next_snapshot_json | TEXT | 写入后页面快照 |
| reverted_at | TEXT | 被撤销时间 |
| reverted_by | TEXT | 撤销操作者 |
| revert_activity_id | TEXT | 对应撤销活动 ID |
| created_at | TEXT | 创建时间 |

撤销按 activity 顺序还原快照，不做多版本合并。`create` 撤销会软删除页面，`edit` / `refresh` 撤销会恢复 `prev_snapshot_json`。`delete` 记录软删除前快照，但当前不开放撤销入口。

### tasks

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Task ID |
| project_id | TEXT FK | 所属 Project |
| title | TEXT | 任务标题 |
| description | TEXT | 任务描述 |
| source | TEXT | human / agent / rule / cron |
| status | TEXT | backlog / executing / reviewing / blocked / completed |
| stage | TEXT | 当前阶段描述 |
| assigned_agent_id | TEXT | 指派的 Agent |
| team_id | TEXT | 所属 Team；为空表示普通项目任务 |
| assignee_member_id | TEXT | 指派的 TeamMember；为空表示未按团队成员指派 |
| created_at | TEXT | 创建时间 |
| completed_at | TEXT | 完成时间 |

任务表不新增会话字段。`task.assign` 将任务默认执行会话按 Agent 写入 `task_events` 的 `execution_session_assigned` 事件；Step 显式 `sessionId` 优先，其次仅在 Agent 匹配时继承任务默认执行会话，再回退到该 Agent 主会话或新建会话。`session_linked` 仍用于记录每次实际派发关联的会话。

### event_categories

事件类别支持全局和项目两种作用域：`project_id` 为空表示全局类别，`scope_key` 固定为 `__global__`；项目类别的 `project_id` 和 `scope_key` 都使用项目 ID。同一作用域内 `(scope_key, id)` 唯一。项目页面读取类别时返回“全局类别 + 当前项目类别”，同名类别由项目类别覆盖全局类别。事件和订阅只保存 `category_id`，运行时按 `project_id` 先解析项目类别，再回退全局类别。

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT | 事件类别 key，例如 `ai.hot_project` |
| project_id | TEXT | 所属 Project；为空表示全局类别 |
| scope_key | TEXT | 类别作用域键；全局固定为 `__global__`，项目类别使用 `project_id` |
| name | TEXT | 类别显示名称 |
| description | TEXT | 类别说明 |
| schema_json | TEXT | 该类别 `payload_json` 的字段模板 JSON |
| default_priority | TEXT | 默认优先级 |
| allowed_writers_json | TEXT | 允许写入的 Agent/来源列表，`["*"]` 表示不限 |
| allowed_consumers_json | TEXT | 允许消费的 Agent 列表，`["*"]` 表示不限 |
| enabled | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

系统默认种子类别为 `agent.project`、`ai.hot_project`、`repo.commit`、`task.candidate`、`work.shipped`；任务生命周期事件使用内置类别 `task.lifecycle`，通过 payload 字段表达任务状态、指派对象和变更类型。类别只能停用或更新，不应让 Agent 运行时随意创建未管理类别。

### event_center_events

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 事件 ID |
| project_id | TEXT | 所属 Project；为空表示全局事件 |
| category_id | TEXT | 事件类别 key |
| title | TEXT | 事件标题 |
| summary | TEXT | 事件摘要 |
| source_type | TEXT | 来源类型，例如 agent / system / manual |
| source_id | TEXT | 来源 ID |
| source_label | TEXT | 来源显示名 |
| priority | TEXT | low / medium / high |
| confidence | REAL | 0 到 1 的置信度 |
| status | TEXT | pending / running / consumed / failed / ignored / task / archived |
| tags_json | TEXT | 标签数组 JSON |
| payload_json | TEXT | 类别动态字段 JSON |
| evidence_json | TEXT | 证据数组 JSON |
| dedupe_key | TEXT | 去重 key |
| created_by_agent_id | TEXT | 写入事件的 Agent ID |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |
| archived_at | TEXT | 归档时间 |

`event_center_events` 是产品事件收件箱，不是 `session_events`。`session_events` 保存会话执行过程和诊断事件；`event_center_events` 保存可筛选、可消费、可转任务的业务信号。

事件列表支持按 `project_id`、`category_id`、`status` 和关键字过滤，并通过 `limit` / `offset` 分页返回，避免事件量增长后前端一次性加载完整收件箱。

### event_subscriptions

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 订阅规则 ID |
| project_id | TEXT | 所属 Project；为空表示全局规则 |
| name | TEXT | 规则名称 |
| category_id | TEXT | 订阅的事件类别 |
| consumer_agent_id | TEXT | 消费 Agent ID |
| consumer_label | TEXT | 消费者显示名 |
| action_mode | TEXT | create_pending 等动作模式 |
| filter_json | TEXT | 过滤条件 JSON，例如 priority / sourceType / minConfidence / payload 字段 |
| enabled | INTEGER | 是否启用 |
| auto_start | INTEGER | 是否自动启动消费者 |
| consumer_session_mode | TEXT | 消费会话策略：`existing` / `new_each` / `new_fixed` |
| consumer_session_id | TEXT | 指定或固定复用的消费者 Session ID；`new_fixed` 首次自动创建后写回 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

`auto_start = 1` 时，新匹配事件会自动创建消费记录并触发消费者 Agent。自动触发按 `subscription_id` 串行调度；当策略为 `existing` 或 `new_fixed` 时，实际 Prompt 进入同一个 Session 的 `enqueuePrompt` 队列，避免并发轮次互相冲突。

订阅过滤支持 `filter.payload`，可按 payload 字段路径匹配。字段值支持相等、`null`、`{ "in": [...] }` 和 `{ "exists": true/false }`，用于把同一事件类别按业务状态细分给不同消费者。

### event_consumptions

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 消费记录 ID |
| event_id | TEXT | 事件 ID |
| subscription_id | TEXT | 来源订阅规则 ID |
| project_id | TEXT | 所属 Project |
| consumer_agent_id | TEXT | 消费 Agent ID |
| consumer_label | TEXT | 消费者显示名 |
| status | TEXT | pending / running / succeeded / failed |
| result_summary | TEXT | 消费结果摘要 |
| result_json | TEXT | 消费结果结构化 JSON |
| error | TEXT | 失败信息 |
| session_id | TEXT | 实际启动消费者 Agent 时使用的 Session ID |
| claimed_at | TEXT | 领取时间 |
| completed_at | TEXT | 完成时间 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### event_task_links

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 链接 ID |
| event_id | TEXT | 事件 ID |
| task_id | TEXT | 普通任务 ID |
| created_at | TEXT | 创建时间 |

### teams

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Team ID |
| project_id | TEXT FK | 所属 Project |
| name | TEXT | Team 名称 |
| description | TEXT | Team 描述 |
| status | TEXT | active / archived |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |
| archived_at | TEXT | 归档时间 |

### team_members

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | TeamMember ID |
| team_id | TEXT FK | 所属 Team |
| project_id | TEXT FK | 所属 Project |
| agent_id | TEXT FK | 绑定的项目级 Agent |
| session_id | TEXT FK | 当前团队会话 |
| name | TEXT | 成员显示名 |
| role | TEXT | leader / member 等业务标签 |
| status | TEXT | active / removed |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### team_mailbox

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Mailbox 消息 ID |
| team_id | TEXT FK | 所属 Team |
| project_id | TEXT FK | 所属 Project |
| from_member_id | TEXT | 发送成员 |
| to_member_id | TEXT | 接收成员（可空） |
| task_id | TEXT | 关联 Team Task（可空） |
| type | TEXT | message / report / question / result |
| content | TEXT | 消息内容 |
| payload_json | TEXT | 结构化附加数据 |
| created_at | TEXT | 创建时间 |

### team_events

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Team 事件 ID |
| team_id | TEXT FK | 所属 Team |
| type | TEXT | 事件类型 |
| payload_json | TEXT | 事件载荷 |
| sequence | INTEGER | Team 内单调递增序号 |
| created_at | TEXT | 创建时间 |

### rules

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Rule ID |
| project_id | TEXT FK | 所属 Project（可空则全局） |
| name | TEXT | 规则名称 |
| description | TEXT | 描述 |
| cron | TEXT | Cron 表达式 |
| action | TEXT | 动作类型 |
| action_config | TEXT (JSON) | 动作配置 |
| enabled | INTEGER | 是否启用 |
| last_run_at | TEXT | 上次执行时间 |
| next_run_at | TEXT | 下次执行时间 |
| run_count | INTEGER | 执行次数 |

定时规则的会话策略保存在 `action_config.session_mode` 与 `action_config.session_id`。`new_fixed` 首次执行会创建会话并把生成的 `session_id` 写回 `action_config`，后续触发继续复用；`existing` 必须指向已存在且属于目标 Agent/Project 的会话；`new_each` 每次触发创建新会话。

### tools

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Tool ID |
| name | TEXT | 工具标识 |
| display_name | TEXT | 显示名称 |
| description | TEXT | 工具描述 |
| category | TEXT | 分类 |
| type | TEXT | builtin / mcp / script |
| config_json | TEXT | 工具配置 |
| input_schema_json | TEXT | 输入 schema |
| permissions_json | TEXT | 权限配置 |
| enabled | INTEGER | 是否启用 |
| is_builtin | INTEGER | 是否内置 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### tool_bindings

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 绑定 ID |
| tool_id | TEXT FK | 工具 ID |
| scope | TEXT | global / project / agent |
| target_id | TEXT | 绑定目标 ID |
| enabled | INTEGER | 是否可见；`0` 表示在该 scope/target 上显式隐藏上层绑定 |
| config_override_json | TEXT | 覆盖配置 |
| created_at | TEXT | 创建时间 |

可见性解析按 `agent > project > global` 覆盖。`team.*` 内置工具不会默认写入全局绑定，通常通过 Agent 级 Profile 或单个方法开关写入 `tool_bindings`。

### tool_contexts

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 工具上下文 ID |
| token_hash | TEXT UNIQUE | 工具上下文 token 的 SHA-256 哈希 |
| session_id | TEXT | 平台 Session ID |
| acp_session_id | TEXT | ACP Session ID（可空） |
| agent_id | TEXT | Agent ID |
| project_id | TEXT | Project ID（可空） |
| team_id | TEXT | Team ID（可空） |
| team_member_id | TEXT | TeamMember ID（可空） |
| visible_tools_json | TEXT | 当前 token 可见的 MCP tool method 名称数组 |
| expires_at | TEXT | 过期时间 |
| revoked_at | TEXT | 撤销时间；非空表示不可再用 |
| created_at | TEXT | 创建时间 |

### tool_call_audit

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 工具调用审计 ID |
| session_id | TEXT | 平台 Session ID |
| agent_id | TEXT | Agent ID |
| project_id | TEXT | Project ID（可空） |
| tool_name | TEXT | MCP tool method 名称 |
| input_json | TEXT | 调用入参 JSON |
| output_json | TEXT | 调用结果 JSON |
| status | TEXT | running / succeeded / failed / denied / timeout |
| started_at | TEXT | 开始时间 |
| ended_at | TEXT | 结束时间 |
| error | TEXT | 错误信息 |

### model_providers

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Provider ID |
| name | TEXT | 名称 |
| display_name | TEXT | 显示名称 |
| protocol | TEXT | openai / claude / new-api |
| base_url | TEXT | API 基础地址 |
| api_key | TEXT | 密钥 |
| models_json | TEXT | 模型列表 JSON |
| is_default | INTEGER | 是否默认 |
| enabled | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### model_profiles

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 模型档案 ID |
| name | TEXT | 档案名称 |
| runtime | TEXT | claude / codex |
| provider_id | TEXT | 关联的模型供应商 ID |
| config_json | TEXT | runtime 专属配置；Claude 保存 default/haiku/sonnet/opus 映射和 `allowImageRead` 主动读图策略，Codex 保存 model/effort |
| context_window | INTEGER | 模型上下文窗口；为空表示未指定 |
| is_default | INTEGER | 是否为该 runtime 的默认档案；同一 runtime 仅一个启用档案应为默认 |
| enabled | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### skills

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | Skill ID |
| name | TEXT | 技能标识 |
| display_name | TEXT | 显示名称 |
| description | TEXT | 描述 |
| type | TEXT | prompt / file / mcp |
| content | TEXT | 技能内容 |
| category | TEXT | 分类 |
| enabled | INTEGER | 是否启用 |
| is_builtin | INTEGER | 是否内置 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

### skill_bindings

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 绑定 ID |
| skill_id | TEXT FK | 技能 ID |
| scope | TEXT | global / project / agent |
| target_id | TEXT | 绑定目标 ID |
| enabled | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |

### schema_migrations

| 列 | 类型 | 说明 |
|----|------|------|
| version | TEXT PK | 迁移版本号 |
| name | TEXT | 迁移名称 |
| applied_at | TEXT | 应用时间 |

SQLite schema 由 `src/store/migrator.ts` 和 `src/store/migrations/*` 管理。新增表、字段或索引必须通过新的 migration 文件落地，`db.ts` 只负责数据库初始化和旧 JSON 数据导入。

### settings

| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | 设置键，如 `machineId`、`runtime.globalModelProfile.claude`、`runtime.globalModelProfile.codex` |
| value | TEXT NOT NULL | 设置值 |
| updated_at | TEXT NOT NULL | 更新时间 |

通用键值存储,目前用于持久化 `machineId`(`src/core/agent-hub/machine-id.ts`),A2A Hub 跨机器通信时区分不同机器。后续其他全局设置也可放入此表。

## 事件类型 (session_events.type)

| 类型 | 说明 |
|------|------|
| `lifecycle.*` | ACP runtime/session 生命周期阶段；payload 使用 messageId/role/content，不会写入最终 Agent 回复正文 |
| `message.chunk` | 消息内容增量 |
| `message.done` | 消息完成 |
| `thinking.chunk` | 思考内容增量 |
| `tool.call` | 工具调用创建 |
| `tool.update` | 工具调用状态更新 |
| `plan.update` | 计划更新 |
| `usage.update` | Token 用量更新 |
| `config.update` | 配置选项更新 |
| `permission.request` | 权限请求 |
| `permission.result` | 权限响应 |
| `mode.update` | 模式切换 |
| `session.info` | 会话信息更新 |
| `elicitation.result` | 提问结果 |

## Session 管理约定

- `sessions.list` 默认只返回 `deleted_at IS NULL` 的记录。
- `sessions.delete` 是软删除，仅写入 `deleted_at`，不级联删除 `messages` / `session_events`。
- `sessions.rename` 写入 `sessions.title`；如果 Agent 通过 ACP 上报 `sessionInfo.title` 且当前标题为空，后端会自动补全标题。
- `session.fork` 会继承源 Session 的 `project_id`，并将项目 `work_dir` 继续传给 ACP runtime。
- `sessions.copy` 会创建新的 Session，先通过 ACP fork 复制 runtime 上下文，再复制最近 10 条 `messages` 及这些消息关联的 `session_events`。复制时会生成新的 message/event id，并重写事件里的 message 引用；不会复制 Team 成员关系或 timeline 摘要缓存。


## 项目级 Agent 字段约定

`agent_templates` 保存全局模板，`agents` 保存部署到项目后的运行时实例。项目级 Agent 通过 `agents.project_id` 归属到 Project；Session 创建和 MCP 工具上下文解析都应沿用这个项目边界。

| 字段 | 类型 | 说明 |
|----|------|------|
| project_id | TEXT | 所属项目；为空表示全局/兼容 Agent |
| template_id | TEXT | 来源模板 ID；自定义 Agent 可为空 |
| system_prompt | TEXT | 项目级 Agent 的系统提示词 |
| icon | TEXT | UI 图标标识 |
| config_json | TEXT | Agent 运行时配置；模板部署会记录 `templateId` 和 `skills`，模型档案绑定记录为 `modelProfileId`，模型策略记录为 `modelProfileMode=global|fixed|system`。旧数据有 `modelProfileId` 时按 `fixed` 解释，无绑定时按 `global` 解释 |

项目工作台默认只展示 `project_id = 当前项目` 的 Agent。`project_id IS NULL` 的 Agent 只用于全局兼容场景，不应混入项目会话。

`modelProfileId` 必须指向与 Agent `runtime` 一致的 `model_profiles` 记录。Agent runtime 改变、档案删除或档案 runtime 改变时，后端会移除不再匹配的绑定。


### ACP 生命周期持久化说明

- `sessions.create` 只写入本地 SQLite session。直到首次 prompt 或显式切换 model/mode/config 连接 ACP runtime 前，`sessions.acp_session_id` 都是 `NULL`。
- Session 空闲回收只关闭/断开 runtime 侧 ACP session 映射；保留 `sessions.acp_session_id`、messages 和 `session_events`，所以下次 prompt 可以 resume/load 同一个 ACP session 或 Codex thread。
- `sessions.runtime_preferences_json` 是 session 级模型、模式和配置选择的后端事实源。`session.setModel`、`session.setMode`、`session.setConfig` 成功后写入该字段；ACP `newSession` / `resumeSession` / `loadSession` / fork 初始化能力后会优先恢复保存值。
- `agents.sort_order` 和 `sessions.sort_order` 只表达工作台左侧列表的用户自定义顺序。Agent 排序限定在同一 `project_id` 内；Session 排序限定在同一 `project_id + agent_id` 内。未传项目/Agent 作用域的兼容列表仍保持原有时间顺序。
- 没有保存模式时，Codex session 默认请求 `agent-full-access`，Claude Code session 默认请求 `bypassPermissions`；如果 runtime 当前能力没有提供该模式，则保留 ACP 返回的实际模式。
- Runtime 空闲回收会在没有已连接 session 后停止 `codex-acp` / `claude-agent-acp` 进程，不修改已持久化的会话历史。
- `session_events.type = lifecycle.*` 记录可见阶段，例如 runtime 启动、session 恢复/创建、prompt 已发送、空闲断开和失败。

## Global Session Dock

`global_session_dock` 保存 owner 的跨项目会话入口。它只引用既有 Session，不复制消息、运行状态或未读状态；列表查询按需关联 Session、Agent 和 Project 生成轻量 DTO。

| 列 | 类型 | 说明 |
|----|------|------|
| session_id | TEXT PK/FK | 固定的 Session ID；Session 物理删除时级联清理 |
| sort_order | INTEGER | 全局会话坞内的稳定顺序，不影响 Workspace 排序 |
| added_at | TEXT | 加入时间 |
| updated_at | TEXT | 最近排序更新时间 |

只有 `purpose = conversation` 且属于项目、未删除、未归档、非模板的 Session 会进入读模型。运行态由 active prompt、running Agent 消息、未完成过程项和 Session 阶段共同计算；未读由最新完成消息/`message.done` 与 `sessions.last_read_at` 比较。自主 Session 不会进入会话坞。

## Desktop Widget State

Desktop Widget 使用两张轻量表保存本地状态，不复制 Session、Agent 或 Task 数据。

### widget_read_state

| 列 | 类型 | 说明 |
|----|------|------|
| session_id | TEXT PK | 已查看的 Session ID |
| read_at | TEXT | 最后查看时间 |

Widget 会话未读判断使用最新非 running Agent 消息时间和最新 `session_events.type = message.done` 时间中的较新值，与 `read_at` 比较。完成时间晚于 `read_at`，或没有 `read_at`，表示未读。

### widget_preferences

| 列 | 类型 | 说明 |
|----|------|------|
| key | TEXT PK | 偏好键，例如 `pinnedProjectId` / `pinnedAgentId` |
| value | TEXT | 偏好值 |
| updated_at | TEXT | 更新时间 |

Widget 偏好只影响悬浮窗过滤和任务快速创建，不改变 Project、Agent、Session 或 Task 的所有权。

## 项目秘书

项目秘书数据按 `project_id` 隔离。每个秘书拥有一个后台运行 Session 和一个独立对话 Session；两类 Session 的 `purpose` 分别为 `secretary_runtime` 与 `secretary_chat`，不进入普通会话列表或普通项目会话统计。

| 表 | 作用 |
|---|---|
| `project_secretaries` | 名称、定义 Prompt、汇报 Prompt、执行 Agent、Session 引用、启用状态和最近运行错误 |
| `project_secretary_observers` | 秘书与项目内观察 Agent 的多对多关系；`observe_all` 表示观察项目全部 Agent |
| `project_secretary_triggers` | Cron、Session 完成、Task needs-input/blocked 等触发配置 |
| `project_secretary_runs` | 持久化运行队列；状态为 `pending`、`running`、`succeeded` 或 `failed`，使用 `dedupe_key` 去重。服务重启时遗留的 `running` 记录会重新排队 |
| `secretary_threads` | 邮箱主题、摘要、优先级、未读状态、Markdown 正文和附件引用；归档主题收到同 `thread_key` 的新汇报时恢复为 open |
| `secretary_entries` | 主题的秘书正文历史 |

秘书运行只消费当前项目事件，Task 触发还会按观察 Agent 过滤；附件只保存当前项目内相对路径，正文按需通过现有文件读取接口访问。

秘书摘要的 `unreadCount` 是未归档且未读的 `secretary_threads` 数量；`chatUnread` 不落新字段，而是从 `secretary_chat` Session 的 `last_message_at` 和 `last_read_at` 派生。两者独立计算，前端可合并成提醒总数，但标记对话已读不会清除邮箱未读。
