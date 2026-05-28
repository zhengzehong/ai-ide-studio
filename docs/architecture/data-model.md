# 数据模型

## 实体关系

```
Project 1:N Agent
Project 1:N Session
Project 1:N Task
Project 1:N Rule
AgentTemplate 1:N Agent
Agent 1:N Session
Task  1:N Session
Task  N:1 Agent (assigned_agent_id)
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
| timestamp | TEXT | ISO 时间戳 |

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
| created_at | TEXT | 创建时间 |
| completed_at | TEXT | 完成时间 |

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
| enabled | INTEGER | 是否启用 |
| config_override_json | TEXT | 覆盖配置 |
| created_at | TEXT | 创建时间 |

### tool_contexts

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | 工具上下文 ID |
| token_hash | TEXT UNIQUE | 工具上下文 token 的 SHA-256 哈希 |
| session_id | TEXT | 平台 Session ID |
| acp_session_id | TEXT | ACP Session ID（可空） |
| agent_id | TEXT | Agent ID |
| project_id | TEXT | Project ID（可空） |
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
| protocol | TEXT | openai / claude |
| base_url | TEXT | API 基础地址 |
| api_key | TEXT | 密钥 |
| models_json | TEXT | 模型列表 JSON |
| is_default | INTEGER | 是否默认 |
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


## ?????????

`agent_templates` ???????`agents` ???????????????????Session ??? MCP ???????????? `agents.project_id` ?????

### agents ?????

| ? | ?? | ?? |
|----|------|------|
| project_id | TEXT | ?????? UI ??? Agent ???? |
| template_id | TEXT | ?????????? Agent ??? |
| system_prompt | TEXT | ???????????????????? |
| icon | TEXT | ???? |
| config_json | TEXT | ????????????? `templateId` ? `skills` ?? |

???????? `project_id IS NULL` ???? Agent?????????????????????


### ACP 生命周期持久化说明

- `sessions.create` 只写入本地 SQLite session。直到首次 prompt 或显式切换 model/mode/config 连接 ACP runtime 前，`sessions.acp_session_id` 都是 `NULL`。
- Session 空闲回收只关闭/断开 runtime 侧 ACP session 映射；保留 `sessions.acp_session_id`、messages 和 `session_events`，所以下次 prompt 可以 resume/load 同一个 ACP session 或 Codex thread。
- Runtime 空闲回收会在没有已连接 session 后停止 `codex-acp` / `claude-agent-acp` 进程，不修改已持久化的会话历史。
- `session_events.type = lifecycle.*` 记录可见阶段，例如 runtime 启动、session 恢复/创建、prompt 已发送、空闲断开和失败。
