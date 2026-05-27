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
| started_at | TEXT | 开始时间 |
| closed_at | TEXT | 关闭时间 |

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
| `session_info.update` | 会话信息更新 |
| `elicitation.result` | 提问结果 |
