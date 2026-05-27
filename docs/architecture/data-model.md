# 数据模型

## 实体关系

```
Agent 1:N Session
Task  1:N Session
Task  N:1 Agent (assigned_agent_id)
Session 1:N Message
Session 1:N SessionEvent (append-only 事件溯源)
Task    1:N TaskEvent
```

## 实体状态机

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
| name | TEXT | 规则名称 |
| description | TEXT | 描述 |
| cron | TEXT | Cron 表达式 |
| action | TEXT | 动作类型 |
| action_config | TEXT (JSON) | 动作配置 |
| enabled | INTEGER | 是否启用 |
| last_run_at | TEXT | 上次执行时间 |
| next_run_at | TEXT | 下次执行时间 |
| run_count | INTEGER | 执行次数 |

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
