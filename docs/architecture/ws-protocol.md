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
| `agents.list` | `{ projectId? }` | `Agent[]` | 列出 Agent，可按项目过滤 |
| `agents.create` | `{ type, name, runtime, config? }` | `Agent` | 创建 Agent |

### Session 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sessions.list` | `{ agentId?, projectId? }` | `Session[]` | 列出 Session |
| `sessions.create` | `{ agentId, taskId?, projectId? }` | `Session` | 创建 Session |
| `sessions.rename` | `{ sessionId, title }` | `Session` | 重命名 Session |
| `sessions.close` | `{ sessionId }` | `Session` | 关闭 ACP 会话并标记为 closed |
| `sessions.archive` | `{ sessionId }` | `Session` | 归档 Session |
| `sessions.delete` | `{ sessionId }` | `{ deleted: true }` | 软删除 Session，默认列表不再返回 |
| `session.getModels` | `{ sessionId }` | `SessionCapabilities` | 获取模型/模式/配置选项 |
| `session.setModel` | `{ sessionId, modelId }` | `void` | 切换模型 |
| `session.setMode` | `{ sessionId, modeId }` | `void` | 切换模式 |
| `session.setConfig` | `{ sessionId, configId, value }` | `void` | 切换配置 |
| `session.fork` | `{ sessionId }` | `Session` | Fork 会话 |
| `sessions.messages` | `{ sessionId, limit?, before? }` | `Message[]` | 查询消息历史 |
| `sessions.events` | `{ sessionId, limit?, afterSequence? }` | `SessionEvent[]` | 查询事件 |
| `prompt` | `{ sessionId, content, images? }` | `{ status }` | 发送消息 |
| `permission.respond` | `{ sessionId, permissionRequestId, optionId?, cancelled? }` | `void` | 响应权限请求 |
| `elicitation.respond` | `{ sessionId, elicitationRequestId, action, content? }` | `void` | 响应提问请求 |
| `decision` | `{ sessionId, messageId, choice }` | `void` | 响应决定 |

### Task 管理

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `tasks.list` | `{ status?, projectId? }` | `Task[]` | 列出任务，可按项目过滤 |
| `tasks.create` | `{ title, description?, assignAgentId?, projectId? }` | `Task` | 创建任务 |
| `tasks.update` | `{ taskId, status?, stage? }` | `Task` | 更新任务状态 |

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
| `session:update` | `{ sessionId, agentId, data }` | Session 流式状态变更（含消息流、工具调用、提问、权限、计划） |
| `session:event` | `{ sessionId, agentId?, event }` | 持久化事件 |
| `session:done` | `{ sessionId, agentId, messageId, turnUsage? }` | Agent 回复完成 |
| `session:capabilities` | `{ sessionId, capabilities }` | 会话能力信息 |
| `session:changed` | `{ sessionId, data }` | Session 标题、状态、归档/删除等列表元数据变更 |
| `agent:status` | `{ agentId, status }` | Agent 在线状态 |
| `task:update` | `{ taskId, data }` | Task 状态变更 |
| `rule:update` | `{ ruleId, data }` | Rule 状态变更 |

## 类型定义

完整 TypeScript 类型定义见 `src/types/ws-protocol.ts`。

## 项目级约定

- 项目级能力（工作台、任务、自动化、文件浏览）必须携带 `projectId`。
- `projectId` 缺失时，只允许访问全局页（概览、Agent 广场、设置）。
- `session.getModels` 返回的 capabilities 由 ACP host 合并模型、模式、配置、命令等能力后上报。
- Session 删除使用软删除：`sessions.delete` 写入 `deleted_at`，保留 `messages` 和 `session_events` 历史数据；`sessions.list` 默认过滤已删除记录。
