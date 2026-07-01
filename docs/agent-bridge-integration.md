# Agent Bridge 接入说明

AI IDE Studio 通过 `agent-bridge-server`(独立的 Python/FastAPI 消息服务器)与外部 AI Agent(Claude Code / Codex / Cursor 等)互相收发消息。本文档说明 AI Studio 侧作为**接收端**如何接入。

## 机制

外部 Agent A 发消息给 AI Studio 注册的 Agent B 时:

1. Agent A 调用 agent-bridge-server API 发消息
2. agent-bridge-server 异步 POST 到 Agent B 注册时配置的 `callbackUrl`
3. AI Studio 的 `POST /api/bridge/callback` 接收回调,校验 token,按 `extra.sessionId` 路由到对应 session
4. 消息内容拼成文本 prompt,通过 `sessionManager.enqueuePrompt` 注入(session 正忙则排队)
5. AI Studio 立即返回 200,异步处理 enqueue(消息服务器有重试,同步等会超时)

## 回调 Payload 格式

```json
{
  "event": "message.received",
  "messageId": "msg-xxx",
  "fromAgentId": "agent-xxx",
  "fromAgentName": "Agent-A",
  "toAgentId": "agent-xxx",
  "toAgentName": "Agent-B",
  "content": {
    "type": "text",
    "text": "消息正文"
  },
  "conversationId": "conv-xxx",
  "timestamp": 1782835637465,
  "extra": {
    "platform": "ai-studio",
    "agentId": "local-xxx",
    "sessionId": "sess-xxx"
  }
}
```

`content` 支持三种形态:
- `{"type": "text", "text": "..."}` — 纯文本
- `{"type": "json", "data": {...}}` — JSON 对象,会渲染为 ```json 代码块
- `{"type": "text", "text": "...", "files": [{"fileId": "file-xxx", "name": "report.md", "size": 50, "mimeType": "application/octet-stream"}]}` — 带附件的文本

`extra.sessionId` 必填,对应 AI Studio 内部的 session.id,用于路由。

## 接入步骤

### 1. 配置 AI Studio 环境变量

在 `.env` 加:

```
BRIDGE_CALLBACK_TOKEN=your-secret-token
# BRIDGE_SERVER_URL=http://127.0.0.1:18801  # 占位,主动发消息时用,本轮可不配
```

`BRIDGE_CALLBACK_TOKEN` 留空则跳过校验(方便本地调试,生产环境**必须**配)。

### 2. 配置 skill config

在 agent-bridge skill 包的 `config.json` 配:

```json
{
  "brokerUrl": "http://127.0.0.1:18801",
  "callbackUrl": "http://<studio-host>:18800/api/bridge/callback",
  "callbackToken": "your-secret-token",
  "extra": {
    "platform": "ai-studio",
    "agentId": "local-xxx",
    "sessionId": "sess-xxx"
  }
}
```

`callbackToken` 必须与 AI Studio 的 `BRIDGE_CALLBACK_TOKEN` 一致。
`extra.sessionId` 必填,对应 AI Studio 中一个真实存在的 session.id,否则回调会被拒(返回 400 / 404)。

### 3. 注册 Agent

```bash
python skill/scripts/register.py
```

skill 会用 config.json 向 agent-bridge-server 注册 Agent,带上 callbackUrl 和 extra。

### 4. 外部 Agent 发消息

外部 Agent 用 send 脚本给这个 AI Studio Agent 发消息:

```bash
python skill/scripts/send.py --to <ai-studio-agent-id> --text "你好"
```

### 5. 验证

AI Studio 对应 session 应收到一条 prompt,内容格式:

```
[来自外部 Agent Agent-A (agentId=agent-xxx, conv=conv-xxx, time=2026-07-01T...)]

你好
```

## 错误响应

| 状态码 | 场景 | body |
|--------|------|------|
| 200 | 成功 enqueue | `{ok: true, messageId, sessionId}` |
| 200 | 非 `message.received` 事件,跳过 | `{ok: true, skipped: true, reason}` |
| 400 | JSON 解析失败 | `{error: 'invalid json'}` |
| 400 | `extra.sessionId` 缺失 | `{error: 'missing extra.sessionId'}` |
| 401 | `X-Callback-Token` 不匹配 | `{error: 'invalid callback token'}` |
| 404 | `sessionId` 在 AI Studio 不存在 | `{error: 'session not found: ...'}` |

## 注意事项

- **不引入新端口**:复用 AI Studio 现有 Hono 服务(默认 18800)
- **token 校验独立**:`/api/bridge/*` 路径跳过 AI Studio 的 `x-ai-ide-token` guard,改用 `X-Callback-Token` 校验
- **enqueue 排队**:目标 session 正在生成时,消息会排队,不会丢失
- **附件不下载**:本轮只把附件元信息(fileId / name / size / mime)拼进 prompt,Agent 需要自行通过 agent-bridge-server 下载
- **无 MCP 工具**:AI Studio 主动发消息给外部 Agent 的能力在下一轮
