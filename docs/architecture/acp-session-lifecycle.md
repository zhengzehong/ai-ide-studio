# ACP 会话生命周期与运行时架构

> 本文档聚焦对话链路里的“本地 Session、ACP runtime 进程、ACP Session、Codex Thread”的对应关系，以及后续应采用的懒连接和空闲回收设计。本文基于当前仓库代码和本地安装的 `@agentclientprotocol/codex-acp@0.0.44` 源码分析。

## 1. 核心结论

1. **ACP runtime 不是对话本身**：runtime 是 `codex-acp` / `claude-agent-acp` 这类子进程；对话是 runtime 内部创建或恢复的 ACP Session。
2. **当前平台是一条 `agentId -> ACP runtime 进程` 的映射**：同一个平台 Agent 下的多个会话共用一个 runtime；不同平台 Agent 即使都使用 `codex` runtime，也会启动不同的 `codex-acp` 进程。
3. **Codex ACP 的 `session/new` 不会为每个会话启动一个新的 Codex 进程**：`codex-acp` 启动时先启动一个 Codex `app-server` 进程；之后每个 ACP Session 通过 `thread/start` 创建一个 Codex Thread。
4. **Codex ACP 一个 runtime 可以承载多个 ACP Session**：`CodexAcpServer` 内部有 `sessions: Map<sessionId, sessionState>`，prompt 时按 `sessionId` 找状态并发送 turn。
5. **Codex ACP 内部没有本平台的 Agent 模板/实例概念**：ACP SDK 里的 Agent 是一个协议处理器；平台的 Agent 模板、Agent 实例、项目作用域都在 AI IDE Studio 这一侧定义和隔离。
6. **长期设计应该把“创建本地会话”和“连接 runtime / 创建 ACP session”拆开**：新建会话只写 SQLite 并立即返回；第一次发送消息时再懒启动 runtime、恢复或创建 ACP session，并把启动阶段明确展示给前端。

## 2. 概念与对应关系

| 概念 | 所在层 | 是否持久化 | 当前标识 | 说明 |
|------|--------|------------|----------|------|
| Project | 平台业务层 | SQLite | `projects.id` | 工作目录、文件作用域、项目级任务/会话边界。 |
| Agent Template | 平台业务层 | SQLite | `agent_templates.id` | 全局 Agent 模板，类似工具箱里的预设。 |
| Agent Instance | 平台业务层 | SQLite | `agents.id` / `agentId` | 模板部署到项目后的运行时实体；当前 runtime 进程按它隔离。 |
| Local Session | 平台业务层/UI 层 | SQLite | `sessions.id` / `ourSessionId` | UI 里的一个对话；可先存在但尚未连接 ACP。 |
| ACP Runtime Process | 平台 ACP Host | 内存进程 | `AgentConnection` | `codex-acp` / `claude-agent-acp` 子进程，由 `src/acp/host.ts` 管理。 |
| ACP Session | ACP 协议层 | runtime 内存 + 可由 runtime 恢复 | `sessions.acp_session_id` | Agent runtime 返回的协议会话 ID。 |
| Codex App Server Process | Codex ACP 内部 | 子进程 | 无平台 ID | `codex-acp` 启动时拉起的 `codex app-server`。 |
| Codex Thread | Codex 内部 | Codex 自己管理 | `thread.id` | Codex ACP 中的 ACP Session ID 等于 Codex Thread ID。 |
| Turn | Codex 内部/ACP 流 | 通常不在平台单独建表 | `turn.id` | 一次 prompt 的执行过程。 |
| Message / Event | 平台展示与审计 | SQLite | `messages.id` / `session_events.id` | 前端刷新和切会话后恢复展示的事实来源。 |

推荐理解为：

```text
Project
  └─ Agent Instance (agentId, runtime=codex/claude/mock)
       └─ Local Session (sessions.id, UI 对话)
            ├─ messages / session_events (平台持久化历史)
            └─ acp_session_id (指向 runtime 内部的 ACP Session)

ACP Host 内存：
agentId -> AgentConnection(runtime 子进程)
AgentConnection.acpSessions: localSessionId -> acpSessionId

Codex ACP 内部：
codex-acp 进程 -> 一个 codex app-server 进程 -> 多个 Codex Thread
Codex Thread ID == ACP Session ID
```

## 3. 当前实现如何工作

### 3.1 新建会话：当前是同步连接 ACP

当前 WS `sessions.create` 直接调用 `sessionManager.createSession`，等整个创建链路结束后才返回前端：

- `src/gateway/ws-handler.ts:354-357`：收到 `sessions.create` 后等待 `sessionManager.createSession(...)`。
- `src/core/sessions.ts:103-118`：
  1. 查 Agent；
  2. 如果 runtime 未运行，调用 `acpHost.startAgent(agentId)`；
  3. 写入 `sessions` 表；
  4. 立即调用 `acpHost.newSession(...)`；
  5. 把返回值写入 `sessions.acp_session_id`。

这意味着“点新会话”会被 runtime 启动、鉴权检查、模型列表拉取、Codex Thread 创建等耗时阻塞。Codex 首次初始化可能十几秒，用户就会感知为新建会话卡顿。

### 3.2 runtime 启动：当前按 agentId 建一个 AgentConnection

`src/acp/host.ts:116-194` 是当前 runtime 进程生命周期核心：

- `acpHost.agents: Map<string, AgentConnection>` 以 `agentId` 为 key。
- `startAgent(agentId)` 会：
  1. 读取 `agents` 表里的 runtime；
  2. 解析 runtime 命令；
  3. `spawn(...)` 启动 `codex-acp` / `claude-agent-acp`；
  4. 用 ACP SDK `ClientSideConnection` 做 `initialize`；
  5. 保存 `AgentConnection` 到 `acpHost.agents`。

`AgentConnection` 里还有：

```ts
acpSessions: Map<string, string> // localSessionId -> acpSessionId
sessionCapabilities: Map<string, SessionCapabilities>
```

所以当前实际映射是：

```text
agentId -> 一个 ACP runtime 子进程
local session id -> 该 runtime 内的 acp session id
```

### 3.3 prompt：当前发送请求立即返回，但后台仍可能先启动/恢复会话

`src/gateway/ws-handler.ts:157-166` 在收到 `prompt` 后先返回 `{ status: 'streaming' }`，然后后台执行 `sessionManager.sendPrompt(...)`。

`src/core/sessions.ts:121-165` 的后台链路是：

1. 追加用户消息到 `messages`。
2. 写入 `session_events` 的 `message.user`。
3. 如果 Agent runtime 未运行，先 `startAgent`。
4. 如果当前内存没有 `localSessionId -> acpSessionId` 映射：
   - DB 有 `sessions.acp_session_id`：调用 `resumeSession`；
   - DB 没有 `sessions.acp_session_id`：调用 `newSession` 并回写 DB。
5. 调用 `acpHost.prompt(...)`。

`src/acp/host.ts:268-305` 负责把文本和图片转换成 ACP `ContentBlock[]` 后调用 `conn.connection.prompt({ sessionId, prompt })`。

### 3.4 当前为什么“像卡住”

前端 `ui/src/stores/session.store.ts:196-203` 发送 prompt 后只立即追加本地 human message，没有立即创建 assistant pending bubble。`生成中`、`正在思考`等视觉反馈依赖后续 `session:update`。如果 Codex 在首次 token / thinking / tool update 前花 10-40 秒，用户会看到 UI 没有明显变化。

因此真实问题不是“Codex 每个 session 都启动一个进程”，而是：

- 新建会话阶段做了太多 ACP 工作；
- prompt 阶段缺少 runtime/session 连接进度事件；
- 前端没有立即展示 assistant pending 状态。

## 4. 当前多会话/多 Agent 行为

| 场景 | 当前行为 | 是否合理 |
|------|----------|----------|
| 同一个 `agentId` 下创建多个 Local Session | 共用一个 `AgentConnection` / runtime 子进程；每个 Local Session 有不同 ACP Session | 协议上合理，Codex ACP 支持。 |
| 不同 `agentId` 都是 `runtime=codex` | 每个 Agent 启动一个 `codex-acp` 进程；每个 `codex-acp` 又启动自己的 Codex app-server | 隔离性好，但资源开销较高。短期保留。 |
| 后端进程重启 | `acpHost.agents` 和 `acpSessions` 内存映射丢失；SQLite 里的 `sessions.acp_session_id` 保留 | 下次 prompt 应通过 `resumeSession` 恢复映射。 |
| runtime 空闲很久 | 当前没有统一 idle 回收策略 | 需要补 runtime manager 和 idle timeout。 |
| close session | 平台会尝试 `session/close`，然后删除内存映射 | Codex ACP 0.0.44 没看到 `closeSession` 实现，当前错误被吞掉；仍可作为平台侧关闭状态处理。 |

## 5. Codex ACP 源码分析

分析版本：`node_modules/@agentclientprotocol/codex-acp/package.json` 中 `version = 0.0.44`，依赖 `@openai/codex ^0.128.0`。

### 5.1 ACP runtime 是怎么启动 Codex 的

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:20972-21005`：

- `startAcpServer()` 读取环境变量：`CODEX_PATH`、`CODEX_CONFIG`、`DEFAULT_AUTH_REQUEST`、`MODEL_PROVIDER`。
- 调用 `const codexConnection = startCodexConnection(codexPath)`。
- 创建 ACP stdio JSON stream。
- `createAgent(...)` 内创建 `CodexAppServerClient`、`CodexAcpClient`、`CodexAcpServer`。
- 最后 `new AgentSideConnection(createAgent, acpJsonStream)`。

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:16826-16843`：

- 如果设置了 `CODEX_PATH`：Windows 下执行 `"${CODEX_PATH}" app-server`，非 Windows 下执行 `${CODEX_PATH} app-server`。
- 如果没设置 `CODEX_PATH`：解析包内 `@openai/codex/bin/codex.js`，用当前 Node 执行 `codex.js app-server`。
- 然后把 `codex.stdout/stdin` 包成 JSON-RPC 连接。

结论：**一个 `codex-acp` runtime 启动时会启动一个 Codex app-server 进程**。这发生在 runtime 启动阶段，不是每次 `session/new` 才启动。

### 5.2 `session/new` 是否启动单独 Codex 进程

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:19204-19228`：

- `CodexAcpClient.newSession(request)` 调用 `codexClient.threadStart(...)`。
- 返回 `sessionId: response.thread.id`。

这里没有 `spawn`。因此：**ACP `session/new` 创建的是 Codex Thread，不是新的 Codex 进程**。

### 5.3 resume/load 的含义

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:19160-19203`：

- `resumeSession(request)` 调用 `codexClient.threadResume({ threadId: request.sessionId, ... })`。
- `loadSession(request)` 也调用 `threadResume`，但额外返回 `thread`，用于加载历史。

结论：如果平台保存了 `sessions.acp_session_id`，runtime 重启后可以用它恢复 Codex Thread，并重建 Codex ACP 内存里的 session state。

### 5.4 一个 Codex ACP runtime 是否支持多个 session

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:19876-19877`：

```js
this.sessions = new Map();
this.pendingMcpStartupSessions = new Map();
```

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:19943-19985`：

- `getOrCreateSession(request)` 根据请求里是否带 `sessionId` 决定 resume 还是 new。
- 构建 `sessionState`。
- `this.sessions.set(sessionId, sessionState)`。

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:20421-20465`：

- `prompt(params)` 通过 `params.sessionId` 找 `sessionState`。
- 为这个 session 注册事件/权限/提问处理器。
- 最后调用 `codexAcpClient.sendPrompt(...)`。

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:19320-19335`：

- `sendPrompt(...)` 调用 `codexClient.runTurn({ threadId: request.sessionId, ... })`。
- `runTurn` 内部是 `turn/start`，不是创建进程。

结论：**一个 Codex ACP runtime 可以管理多个 ACP Session；prompt 时按 sessionId/threadId 路由到对应 Codex Thread。**

### 5.5 “是否有连接的 session”是什么意思

Codex ACP 有两层“连接/已加载”概念：

1. **平台侧内存映射**：`AgentConnection.acpSessions.has(localSessionId)` 表示这个 Local Session 当前已经绑定到某个正在运行的 runtime。
2. **Codex ACP 内存状态**：`CodexAcpServer.sessions.has(acpSessionId)` 表示该 runtime 进程内已经有这个 session 的 `sessionState`。

这两个都是内存状态，不等于持久化历史。真正跨重启保留的是：

- 平台 SQLite 的 `sessions.acp_session_id`；
- Codex 自己能通过 `threadResume` 找回的 thread。

所以推荐逻辑不是“新会话时必须连接”，而是：

```text
如果 Local Session 没有 acp_session_id：第一次 prompt 时 session/new。
如果 Local Session 有 acp_session_id 但当前 runtime 没映射：第一次 prompt 时 session/resume。
如果 runtime 映射已存在：直接 prompt。
```

### 5.6 Codex ACP 的模型和模式是 session 级状态

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:20060-20103`：

- `setSessionMode` 根据 `sessionId` 找 `sessionState`，更新 `sessionState.agentMode`。
- `unstable_setSessionModel` 根据 `sessionId` 找 `sessionState`，更新 `currentModelId`、`supportedReasoningEfforts`、`supportedInputModalities`。

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:20112-20123` 会把可用模型展开成 `model[reasoningEffort]` 形式，所以前端看到的 `gpt-5.1[xhigh]` 这类值本质是 Codex ACP 暴露的 session model id，不是 Claude Code 的模型分类。

### 5.7 ACP SDK 里的 Agent 与平台 Agent 不是一回事

`node_modules/@agentclientprotocol/codex-acp/dist/index.js:15970-16038`：

- `AgentSideConnection` 收到 `session/new`、`session/resume`、`session/set_mode` 等协议方法后，转发给同一个 `agent` handler。

这里的 `agent` 是 ACP 协议处理器对象，不知道平台里的 `agent_templates` / `agents` 表。平台 Agent 实例的隔离完全由 AI IDE Studio 的 `acpHost` 进程管理策略决定。

## 6. 推荐长期架构

### 6.1 设计原则

1. **本地会话先行**：新建会话是 UI/SQLite 行为，不应等待外部 Agent runtime。
2. **runtime 懒启动**：只有第一次 prompt、显式预热、或者需要查询 runtime 实时能力时才启动。
3. **ACP Session 懒创建/懒恢复**：只有真正要和 Agent 对话时才创建或恢复协议会话。
4. **进度可见**：启动 runtime、恢复 session、发送 prompt、等待模型输出都应有前端可见阶段。
5. **空闲可回收**：runtime 进程是昂贵资源，空闲 1 小时后可断开；下次 prompt 通过 `acp_session_id` 恢复。
6. **先隔离，后共享**：短期继续以 `agentId` 作为 runtime key；只有确认 system prompt、工具、权限、cwd、凭据都能 session 级隔离后，才考虑更大粒度的 runtime pool。

### 6.2 推荐 runtime key

第一阶段保留：

```text
RuntimeKey = agentId
```

原因：

- 平台 Agent 是项目级运行实体，后续会承载 system prompt、技能、工具绑定、权限策略。
- Claude Code / Codex 对 session 级隔离能力不完全一致，过早按 runtime 类型共享会污染上下文、权限或工具状态。
- 当前代码已经是 `agentId -> AgentConnection`，改动小，风险低。

未来如果要合并进程，可演进为：

```text
RuntimeKey = projectId + runtime + credentialProfileId + toolProfileHash + adapterIsolationLevel
```

但前提是每个 adapter 明确声明：模型、模式、cwd、system prompt、MCP servers、权限状态都可以按 session 隔离。

### 6.3 推荐状态机

Local Session 的持久状态建议用于业务语义，连接过程用 `stage` 或事件表达：

```text
local
  -> connecting_runtime
  -> connecting_session
  -> ready
  -> running
  -> waiting_permission / waiting_elicitation
  -> ready / idle
  -> closed
  -> failed
```

最小落地可以这样分层：

| 层 | 推荐字段/事件 | 说明 |
|----|--------------|------|
| SQLite `sessions.status` | `local` / `active` / `idle` / `closed` / `failed` | 可刷新恢复的会话主状态。 |
| SQLite `sessions.stage` | `正在启动 Codex`、`正在连接会话`、`正在思考` | 用户可见的短期阶段，可被下一阶段覆盖。 |
| `session_events` | `lifecycle.*` / `message.*` / `tool.*` / `permission.*` | 刷新和切会话后恢复过程与结果。 |
| 内存 runtime state | `starting` / `running` / `stopping` / `stopped` | 不作为事实来源，只反映当前进程。 |

### 6.4 新建会话目标流程

目标：点击“新会话”应立即返回，不能被 Codex/Claude 启动阻塞。

```text
UI 点击新会话
  -> WS sessions.create
  -> sessionStore.create({ agentId, projectId, status: 'local', acp_session_id: null })
  -> 立即返回 Local Session
  -> UI 进入空对话，可输入 prompt
```

此时不做：

- 不启动 `codex-acp` / `claude-agent-acp`；
- 不调用 `session/new`；
- 不拉模型列表；
- 不等待鉴权或 MCP server startup。

如果需要提升体验，可以做“后台预热”，但预热失败不能影响 Local Session 已创建。

### 6.5 第一次 prompt 目标流程

```text
UI sendPrompt
  -> 立即追加 human message
  -> 立即创建 assistant pending bubble
  -> 后端写 message.user / lifecycle.prompt_received
  -> ensureRuntime(agentId)
       - 未启动：emit lifecycle.connecting_runtime: 正在启动 Codex/Claude
       - 已启动：直接复用
  -> ensureAcpSession(localSession)
       - 有内存映射：直接复用
       - DB 有 acp_session_id：emit 正在恢复会话，调用 resumeSession/loadSession
       - DB 无 acp_session_id：emit 正在创建会话，调用 newSession 并回写 DB
  -> emit lifecycle.prompt_sent: 正在思考
  -> acpHost.prompt(...)
  -> session:update 流式消息/工具/权限/提问
  -> session:done
```

前端展示要求：

- prompt 发出后立即出现 assistant 占位，内容如“正在准备 Agent...”或 skeleton；
- 后端每个阶段都能覆盖这个占位的状态文案；
- 一旦有真实 `agent_message_chunk` / thinking / tool call，就替换为真实内容；
- 权限申请和 AI 提问应固定在当前 assistant 回复区域底部，且阻塞态明显。

### 6.6 后续 prompt 目标流程

```text
如果 runtime 还在，且 localSessionId -> acpSessionId 映射存在：
  append user -> pending assistant -> prompt

如果 runtime 已被 idle 回收，但 DB 有 acp_session_id：
  append user -> pending assistant -> start runtime -> resumeSession -> prompt
```

这能保证空闲回收后不会丢历史，也不会在新建会话时卡住。

### 6.7 空闲回收

空闲回收必须分两层处理，不能只停 runtime：

1. **Session idle 回收**：断开某个 Local Session 在 runtime 内部的 ACP Session / Codex Thread / Claude session 连接状态。
   - 条件：该 session 没有 active turn、没有 pending permission/elicitation，且 `Date.now() - session.lastUsedAt > SESSION_IDLE_MS`。
   - 动作：best-effort 调用 `session/close`；无论 close 是否被 runtime 支持，都删除平台内存里的 `localSessionId -> acpSessionId` 映射和 session capabilities 缓存。
   - 约束：不清空 SQLite `sessions.acp_session_id`，下次 prompt 通过 resume/load 恢复。
2. **Runtime idle 回收**：停止 `codex-acp` / `claude-agent-acp` 子进程。
   - 条件：runtime 没有 active turn、没有 connected sessions、没有 pending permission/elicitation，且 `Date.now() - runtime.lastUsedAt > RUNTIME_IDLE_MS`。
   - 动作：优雅 stop runtime，删除 `acpHost.agents[agentId]`。
   - 约束：不修改任何 Local Session 历史和 `acp_session_id`。

推荐默认值：`SESSION_IDLE_MS = 30 分钟`，`RUNTIME_IDLE_MS = 60 分钟`，扫描间隔 5 分钟。

Claude Code 支持 `session/close`，应走正常 close；Codex ACP 当前 close 能力按 best-effort 处理，close 失败不能影响下次 resume。

### 6.8 并发与取消

- 同一个 Local Session 同一时间只允许一个 active turn；第一阶段不做同 session prompt 排队。
- 同一个 Agent 下的不同 Local Session 必须支持并发 prompt；不能加 runtime 级全局串行队列。
- `ensureRuntime(agentId)` 要做启动去重：多个 session 同时首 prompt 时共享同一个 start promise。
- `ensureAcpSession(localSessionId)` 要做 session 级连接去重：同一 session 只允许一个 new/resume promise。
- Codex ACP 按 `threadId` 路由，Claude Code ACP 内部也维护多 session map；两者都应走同一套多 session runtime 模式。
- 停止生成必须优先走 ACP `session/cancel`，不要直接 kill runtime。kill 只作为 runtime 失控时的兜底。

## 7. 为什么不建议现在按 runtime 类型全局共享

看上去 `codex-acp` 一个进程可以承载多个 session，所以可以只启动一个全局 Codex runtime。但平台层面还有这些隔离需求：

- 不同项目的 `cwd` 和文件权限不同；
- 不同 Agent 的 system prompt、技能、工具绑定不同；
- 权限申请、提问、MCP server startup 状态需要归属到具体 Agent/Session；
- Claude Code 与 Codex 的 session/model/mode 能力不完全一致；
- 后续 Agent 实例会是项目级运行实体，不只是 runtime 类型别名。

因此建议阶段化：

1. **P0：继续 `agentId -> runtime`，但改为懒启动 + 进度可见 + idle 回收。**
2. **P1：抽象 RuntimeManager / Adapter 接口，把连接、会话、turn、权限、提问状态统一建模。**
3. **P2：只有在 adapter 声明支持完整 session 级隔离后，再引入 runtime pool。**

## 8. 分阶段落地计划

### P0：解决卡顿和状态不可见

- `sessions.create` 改为只创建 SQLite Local Session，`acp_session_id` 可空。
- `sendPrompt` 开始时立即写入 lifecycle event，并通知前端展示 pending assistant。
- 把 `startAgent/newSession/resumeSession` 收敛到 `ensureRuntime` / `ensureAcpSession`。
- 对前端补充“正在启动/正在连接/正在思考”的阶段展示。
- 保持 runtime key = `agentId`。

### P1：补 runtime 生命周期管理

- 新增 RuntimeManager：管理 `starting/running/stopping/stopped`、`lastUsedAt`、`activeTurnCount`。
- 加 idle 1 小时回收。
- 加 per-session turn lock，避免同一会话重复发送。
- runtime 异常退出时，给相关 session 写 `failed` lifecycle event，但不清除历史。

### P2：完善持久化与恢复

- SQLite migration：补齐 session 状态、stage、错误信息、最后连接时间等字段，或明确复用现有 `status/stage/updated_at`。
- `session_events` 增加/规范 `lifecycle.*` 事件类型。
- 刷新和切换会话时用 `messages + session_events` 还原工具调用、权限、提问、阶段状态。

### P3：按 adapter 能力做进程池优化

- 为 Codex / Claude 各自声明：是否支持多 session、是否支持 session 级 model/mode/cwd/mcpServers/system prompt、是否支持 close/cancel/list/resume。
- 在满足隔离条件后，再考虑从 `agentId` 维度合并到更粗粒度 runtime pool。

## 9. 回答几个关键问题

### Q1：ACP Session 对话时是不是一个单独 Codex 进程？

不是。Codex ACP 0.0.44 中，`codex-acp` 启动时创建一个 Codex `app-server` 进程；`session/new` 调用 `thread/start` 创建 Codex Thread。一个会话对应一个 Codex Thread，不对应一个新的 Codex 进程。

### Q2：新对话是按 session 有没有连接来决定吗？

当前平台不是。当前 `sessions.create` 总是立即启动 runtime 并 `session/new`，所以新对话创建阶段就会连接 ACP。

推荐改成：新对话只创建 Local Session；第一次 prompt 时再按以下顺序判断：

1. 内存已有 `localSessionId -> acpSessionId`：直接 prompt；
2. DB 有 `acp_session_id`：启动 runtime 后 `resumeSession`；
3. DB 没有 `acp_session_id`：启动 runtime 后 `newSession`。

### Q3：ACP runtime 是怎么启动的？

平台侧 `acpHost.startAgent(agentId)` 通过 `spawn(...)` 启动 runtime 命令，例如 `codex-acp`。Codex ACP runtime 内部再根据 `CODEX_PATH` 启动本地 `codex app-server`，没有 `CODEX_PATH` 时使用包内依赖的 `@openai/codex/bin/codex.js app-server`。

### Q4：一个 ACP runtime 可以多个 session 吗？

协议和 Codex ACP 实现都支持。Codex ACP 内部有 `sessions: Map<sessionId, sessionState>`，每次 prompt 按 `sessionId/threadId` 路由。当前平台也已经通过 `AgentConnection.acpSessions` 在同一个 `agentId` runtime 下映射多个 Local Session。

### Q5：有分 Agent 吗？

有，但分层不同：

- **平台 Agent**：`agents` 表里的项目级 Agent 实例，是 AI IDE Studio 的业务概念。
- **ACP Agent handler**：`codex-acp` 进程里处理协议请求的对象，是协议实现概念。
- **Codex 内部**：核心是 Thread/Turn，不知道平台的 Agent 模板和实例。

因此是否一个平台 Agent 一个 runtime，是 AI IDE Studio 的架构策略，不是 Codex ACP 强制要求。短期建议保持这个隔离策略，但把连接时机改成懒连接。
