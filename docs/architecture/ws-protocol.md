# WebSocket RPC 协议

## 连接

```
ws://localhost:18800
```

## 消息格式

所有消息为 JSON 对象，包含 `type` 字段。请求消息包含 `requestId`，响应消息用相同 `requestId` 回复。

## 订阅

连接后自动接收所有事件广播。客户端可通过 `subscribe` 消息选择性订阅。

## RPC 方法

### Agent 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `agents.list` | — | `Agent[]` | 列出所有 Agent |
| `agents.create` | `{ type, name, runtime, config? }` | `Agent` | 创建 Agent |

### Session 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sessions.list` | `{ agentId }` | `Session[]` | 列出 Agent 的所有 Session |
| `sessions.create` | `{ agentId, taskId? }` | `Session` | 创建 Session |
| `session.getModels` | `{ sessionId }` | `SessionCapabilities` | 获取模型/模式/配置选项 |
| `session.setModel` | `{ sessionId, modelId }` | `void` | 切换模型 |
| `session.setMode` | `{ sessionId, modeId }` | `void` | 切换模式 |
| `session.fork` | `{ sessionId }` | `Session` | Fork 会话 |
| `session.events` | `{ sessionId, afterSequence? }` | `SessionEvent[]` | 查询事件 |
| `prompt` | `{ sessionId, content, images? }` | `{ status }` | 发送消息 |
| `permission.respond` | `{ sessionId, requestId, optionId }` | `void` | 响应权限请求 |

### Task 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `tasks.list` | — | `Task[]` | 列出所有任务 |
| `tasks.create` | `{ title, description?, assignAgentId? }` | `Task` | 创建任务 |
| `tasks.update` | `{ taskId, status?, stage? }` | `Task` | 更新任务状态 |
| `tasks.get` | `{ taskId }` | `Task` | 获取任务详情 |

### Rule 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `rules.list` | — | `Rule[]` | 列出所有规则 |
| `rules.create` | `{ name, cron, action, actionConfig }` | `Rule` | 创建规则 |
| `rules.update` | `{ ruleId, enabled?, ... }` | `Rule` | 更新规则 |
| `rules.delete` | `{ ruleId }` | `void` | 删除规则 |

## 事件广播

服务端主动推送的事件类型：

| 事件 | 数据 | 说明 |
|------|------|------|
| `session:update` | `{ sessionId, ...updateData }` | Session 状态变更（含消息流、工具调用） |
| `session:event` | `SessionEvent` | 持久化事件 |
| `session:done` | `{ sessionId, agentId }` | Agent 回复完成 |
| `session:capabilities` | `{ sessionId, capabilities }` | 会话能力信息 |
| `task:update` | `{ taskId, data }` | Task 状态变更 |

## 类型定义

完整 TypeScript 类型定义见 `src/types/ws-protocol.ts`。
