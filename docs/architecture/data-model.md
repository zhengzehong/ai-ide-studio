# 数据模型

## 实体关系

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
Task    1:N TaskEvent
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
| closed_at | TEXT | 关闭时间 |
| archived_at | TEXT | 归档时间 |
| deleted_at | TEXT | 软删除时间；非空时默认列表隐藏 |
| runtime_preferences_json | TEXT | Session runtime preferences JSON；保存 `modelId`、`modeId` 和 session config 选择 |
| sort_order | INTEGER | 项目工作台内同一 Agent 下 Session 自定义排序；仅在项目/Agent 作用域列表中生效 |

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

`turn_process_items.sequence` 是历史执行过程展示顺序的事实来源。列表查询默认不返回大 `detail_json`；用户点击某个过程块时再通过 `sessions.processItemDetail` 获取详情。ACP plan 更新保存为 `kind = plan`，权限和 AI 提问分别保存为 `permission` / `elicitation`，文件修改完整 diff 保存为 `file_change.detail_json`。

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

### event_categories

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 事件类别 key，例如 `ai.hot_project` |
| name | TEXT | 类别显示名称 |
| description | TEXT | 类别说明 |
| schema_json | TEXT | 该类别 `payload_json` 的字段模板 JSON |
| default_priority | TEXT | 默认优先级 |
| allowed_writers_json | TEXT | 允许写入的 Agent/来源列表，`["*"]` 表示不限 |
| allowed_consumers_json | TEXT | 允许消费的 Agent 列表，`["*"]` 表示不限 |
| enabled | INTEGER | 是否启用 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

系统默认种子类别为 `ai.hot_project`、`repo.commit`、`task.candidate`、`work.shipped`。类别只能停用或更新，不应让 Agent 运行时随意创建未管理类别。

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
| filter_json | TEXT | 过滤条件 JSON，例如 priority / sourceType / minConfidence |
| enabled | INTEGER | 是否启用 |
| auto_start | INTEGER | 是否自动启动消费者 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

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
| config_json | TEXT | runtime 专属配置；Claude 保存 default/haiku/sonnet/opus 映射，Codex 保存 model/effort |
| context_window | INTEGER | 模型上下文窗口；为空表示未指定 |
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
| config_json | TEXT | Agent 运行时配置；模板部署会记录 `templateId` 和 `skills`，模型档案绑定记录为 `modelProfileId` |

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
