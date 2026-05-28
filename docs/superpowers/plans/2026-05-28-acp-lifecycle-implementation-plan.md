# ACP 生命周期实现开发计划

## 背景

当前已完成 `docs/architecture/acp-session-lifecycle.md` 的架构设计。用户补充了三个必须纳入实现的约束：

1. 空闲回收要分两层：
   - ACP runtime 回收：回收 `codex-acp` / `claude-agent-acp` 子进程。
   - ACP session / Codex Thread / Claude session 断开：关闭或卸载单个会话在 runtime 内的连接状态。
2. 同一个 Agent 必须支持多个 Session 并发。
3. Claude Code 和 Codex 都要走同一套生命周期模式，不能只为 Codex 特化。

## 成功标准

- 新建会话只创建 SQLite Local Session，不启动 ACP runtime，不创建 ACP session。
- 第一次 prompt 才懒启动 runtime，并按需 `newSession` / `resumeSession`。
- 同一个 Agent 下的多个 Session 可以并发发送 prompt；同一个 Session 同时只允许一个 active turn。
- 空闲回收包含两级：
  - session idle：关闭 runtime 内单个 ACP session 映射，但保留 `sessions.acp_session_id`。
  - runtime idle：在无 active turn、无已连接 session、无 pending permission/elicitation 时停止 runtime 进程。
- `session.cancel` 优先走 ACP `session/cancel`，不直接 kill runtime。
- Claude Code 与 Codex 都通过同一套 adapter 能力和 runtime manager 执行。
- 刷新/切换会话后，消息、工具调用、权限/提问、生命周期阶段仍可从 SQLite 恢复展示。
- `npm test`、`npm run build`、`npm run lint`、`git diff --check` 通过。

## 现有源码依据

### 平台当前行为

- `src/core/sessions.ts`：`createSession` 当前会同步 `startAgent` + `newSession`，这是新会话卡顿来源。
- `src/acp/host.ts`：当前 `acpHost.agents` 是 `agentId -> AgentConnection`；`AgentConnection.acpSessions` 是 `localSessionId -> acpSessionId`。
- `src/gateway/ws-handler.ts`：`prompt` RPC 已经先返回 `{ status: 'streaming' }`，后台执行 prompt。
- `src/acp/host.ts`：已有 `cancelPrompt` 走 `conn.connection.cancel({ sessionId })`，后续要把它作为唯一正常取消路径。

### Codex ACP 能力

- `codex-acp` 启动时创建一个 Codex `app-server` 进程。
- `session/new` 调用 `thread/start`，创建 Codex Thread，不创建新进程。
- `resume/load` 调用 `thread/resume`。
- Codex ACP 内部有 `sessions: Map<sessionId, sessionState>`，支持一个 runtime 多个 session。
- Codex ACP 0.0.44 未看到完整 `closeSession` 实现；平台调用 close 要容错，不能因 close 不支持而丢 DB 映射。

### Claude Code ACP 能力

- `@agentclientprotocol/claude-agent-acp@0.37.0` 声明：
  - `loadSession: true`
  - `sessionCapabilities.close/delete/fork/list/resume`
  - `_meta.claudeCode.promptQueueing: true`
- Claude ACP 内部 `sessions = {}`，可管理多个 session。
- Claude ACP 的单 session 内部有 `promptRunning` 和 `pendingMessages`，支持同一 session 内 prompt 排队；平台第一阶段仍应限制同一 Local Session 同时一个 active turn，避免 UI 和事件归并复杂化。
- Claude ACP 有 `closeSession -> teardownSession -> cancel + dispose + delete this.sessions[sessionId]`，可作为 session idle 断开的优先路径。

## 核心设计调整

### 两级回收模型

```text
Local Session (SQLite, 永久/长期)
  -> Connected ACP Session (runtime 内存映射，可关闭/恢复)
      -> Active Turn (一次 prompt，短生命周期)

Agent Runtime Process (codex-acp/claude-agent-acp)
  -> 0..N Connected ACP Sessions
```

#### 1. Session idle 回收

目标：断开单个 Local Session 在 runtime 内部的连接状态，但保留平台历史。

触发条件建议：

- `session.activeTurnCount === 0`
- 当前 session 没有 pending permission/elicitation
- `Date.now() - session.lastUsedAt > SESSION_IDLE_MS`，默认 30 分钟

动作：

1. 调用 adapter `closeSession(agentId, localSessionId)`。
2. 成功或 adapter 不支持 close 都删除 `AgentConnection.acpSessions[localSessionId]` 与 capabilities 缓存。
3. 不清空 SQLite `sessions.acp_session_id`。
4. 写 `session_events.lifecycle.session_disconnected`，便于刷新后解释“下次会自动恢复”。

Codex 特别说明：

- 如果 `session/close` 不支持或报错，只做 best-effort；仍删除平台内存映射。
- 下次 prompt 通过 SQLite `acp_session_id` 走 `resumeSession`。

Claude 特别说明：

- Claude 支持 close，应正常 teardown session 内部 query/input/settings。
- 下次 prompt 通过 `resumeSession` 恢复。

#### 2. Runtime idle 回收

目标：停止整个 `codex-acp` / `claude-agent-acp` 子进程。

触发条件建议：

- `runtime.activeTurnCount === 0`
- `runtime.connectedSessionCount === 0`
- 该 agent 下没有 pending permission/elicitation
- `Date.now() - runtime.lastUsedAt > RUNTIME_IDLE_MS`，默认 60 分钟

动作：

1. 确认所有 session 已断开或已无内存映射。
2. 调用 `stopAgent(agentId)` 优雅停止 runtime。
3. 删除 `acpHost.agents[agentId]`。
4. 不修改任何 `sessions.acp_session_id`。
5. 写 agent/runtime lifecycle 日志与事件。

### 并发模型

#### Session 级

- 同一个 Local Session 同时只允许一个 active turn。
- 如果同 session 再次 prompt：第一阶段直接拒绝并返回“当前会话正在生成中”；不做排队。
- 原因：前端 streamingMessage、工具调用、权限/提问、done 归并都以当前会话单 active turn 更简单可靠。

#### Agent/runtime 级

- 同一个 Agent 下多个 Local Session 允许并发。
- `AgentConnection` 不做 runtime 级全局互斥锁。
- `ensureRuntime(agentId)` 需要做启动去重：多个 session 同时首 prompt 时，只允许一个 start promise，其他 await 同一个 promise。
- `ensureAcpSession(localSessionId)` 需要做 session 级连接去重：同一 session 同时触发只允许一个 new/resume promise。

#### Adapter 能力开关

新增 adapter capability：

```ts
interface RuntimeAdapterCapabilities {
  supportsMultipleSessions: boolean
  supportsSessionClose: boolean
  supportsSessionResume: boolean
  supportsPromptConcurrency: 'session' | 'runtime' | 'unknown'
}
```

第一阶段配置：

| runtime | multiple sessions | session close | resume | prompt concurrency |
|---------|-------------------|---------------|--------|--------------------|
| codex | true | best-effort/unknown | true | session |
| claude | true | true | true | session |
| mock | true | true | false/内存 | session |

说明：`prompt concurrency = session` 表示允许不同 session 并发，但同 session 单 turn。

## 实现步骤

### Step 1：补 lifecycle plan 与类型

改动：

- `docs/superpowers/plans/2026-05-28-acp-lifecycle-implementation-plan.md`：本文件。
- `src/types/ws-protocol.ts`：补充 lifecycle event payload 类型。
- `src/store/sessions.ts` / `src/store/db.ts`：如需要，扩展 status/stage 字段枚举和迁移。

验证：

- 类型编译通过。
- 不改变现有业务行为。

### Step 2：拆分 createSession，改为 Local Session only

改动：

- `src/core/sessions.ts`
  - `createSession` 只做 `sessionStore.create({ agentId, taskId, projectId })`。
  - 不调用 `acpHost.startAgent`。
  - 不调用 `acpHost.newSession`。
  - `acp_session_id` 初始为 null。
- `tests/unit` 或 integration：补一个“创建 session 不启动 ACP”的测试。

验证：

- 新建会话 RPC 立即返回。
- 旧的 task 自动启动如果依赖 create 后立即 prompt，应由 `sendPrompt` 负责启动 runtime，不破坏任务流。

### Step 3：实现 RuntimeManager / ensureRuntime 启动去重

改动：

- 新增 `src/acp/runtime-manager.ts` 或下沉到 `src/acp/host.ts` 的小模块。
- `AgentConnection` 增加：
  - `state: 'starting' | 'running' | 'stopping' | 'stopped'`
  - `lastUsedAt: number`
  - `activeTurnCount: number`
  - `startPromise?: Promise<void>`
- `acpHost.startAgent` 改为可复用 start promise，避免并发首 prompt 启动多个进程。

验证：

- 两个 session 同时 prompt 同一 agent，只启动一个 runtime。
- runtime 启动失败时，所有等待者收到同一错误，并清理 startPromise。

### Step 4：实现 ensureAcpSession 连接去重

改动：

- 新增 session runtime state：
  - `localSessionId`
  - `acpSessionId?`
  - `state: 'disconnected' | 'connecting' | 'connected' | 'closing'`
  - `lastUsedAt`
  - `activeTurnCount`
  - `connectPromise?`
- 把 `sendPrompt` 中的 `hasAcpSession/newSession/resumeSession` 收敛为 `acpHost.ensureSession(agentId, localSessionId, dbAcpSessionId, context)`。
- `ensureSession` 规则：
  1. 内存已有映射：返回。
  2. DB 有 `acp_session_id`：resume/load。
  3. DB 无：newSession，回写 DB。

验证：

- runtime 回收后再次 prompt 能 resume。
- `acp_session_id` 不因 close/runtime stop 被清空。

### Step 5：实现 active turn 锁与多 session 并发

改动：

- `sendPrompt` 开始时获取 session turn lock。
- 同一 session 已 running：返回明确错误或 lifecycle event。
- 不加 runtime 全局锁，允许不同 session 并发。
- active turn 开始/结束维护：
  - session.activeTurnCount
  - runtime.activeTurnCount
  - lastUsedAt

验证：

- 同一 session 连续发送两条，第二条被拒绝或提示当前生成中。
- 同一 agent 两个不同 session 同时 prompt，都可以进行。
- `session:done` 后 activeTurnCount 回到 0。
- 异常时 finally 也释放锁。

### Step 6：补 lifecycle 事件和前端 pending 状态

改动：

- 后端在关键阶段写入并广播：
  - `lifecycle.prompt_received`
  - `lifecycle.runtime_starting`
  - `lifecycle.runtime_ready`
  - `lifecycle.session_resuming`
  - `lifecycle.session_creating`
  - `lifecycle.session_ready`
  - `lifecycle.prompt_sent`
  - `lifecycle.session_disconnected`
  - `lifecycle.runtime_stopped`
  - `lifecycle.failed`
- 前端 reducer 支持 lifecycle event，映射为 assistant pending bubble/stage。
- prompt 发送后前端立即创建 assistant pending，占位不会等首个 ACP chunk。

验证：

- Codex 首包慢时，UI 立即显示“正在启动/正在连接/正在思考”。
- 刷新后能从 `session_events` 还原最近阶段。

### Step 7：实现 session idle 回收

改动：

- 增加定时扫描，默认每 5 分钟。
- 新增环境变量：
  - `ACP_SESSION_IDLE_MS`，默认 `1800000`。
- 扫描所有 AgentConnection 下的 connected sessions。
- 对满足条件的 session 调用 `closeSession` best-effort。
- 删除内存映射，不清空 DB `acp_session_id`。

验证：

- mock/claude closeSession 被调用。
- codex closeSession 不支持时不影响状态。
- 下次 prompt 能 resume 或 new。

### Step 8：实现 runtime idle 回收

改动：

- 新增环境变量：
  - `ACP_RUNTIME_IDLE_MS`，默认 `3600000`。
- session idle 扫描后，如果 runtime 无 connected session、无 active turn、无 pending interaction，则 stop runtime。
- stop runtime 不关闭/删除 SQLite session。

验证：

- 空闲 runtime 被停止。
- 有 active turn 不会停止。
- 有 pending permission/elicitation 不会停止。
- stop 后再 prompt 会重新 start + resume。

### Step 9：取消逻辑标准化

改动：

- `session.cancel` 只调用 `acpHost.cancelPrompt`。
- `cancelPrompt`：
  - 调 `conn.connection.cancel({ sessionId: acpSessionId })`。
  - cancel pending permission/elicitation。
  - 标记 active turn 结束。
- 只有 runtime 无响应/进程异常时才 kill runtime，作为兜底，不作为普通取消。

验证：

- Claude cancel 触发其 `query.interrupt()`。
- Codex cancel 触发 ACP cancel。
- 取消后同 session 可再次 prompt。

### Step 10：适配 Claude 与 Codex 能力差异

改动：

- 新增 `src/acp/adapters.ts` 或完善现有 adapters：
  - `codex` adapter capability。
  - `claude` adapter capability。
  - `mock` adapter capability。
- session close / resume / model / mode / config 统一走 capability 判断。
- close 不支持时 downgrade 为平台内存断开。

验证：

- Claude Code：session close 后可 resume；多 session 并发不互相阻塞。
- Codex：close best-effort；多 session 并发可启动/恢复。

### Step 11：补测试

建议测试分层：

#### Unit

- RuntimeManager start 去重。
- ensureSession new/resume 分支。
- active turn lock。
- session idle 条件判断。
- runtime idle 条件判断。
- close 不支持时仍删除内存映射但不清 DB。

#### Integration / mock ACP

- 新建 session 不启动 runtime。
- 首 prompt 启动 runtime 并创建 ACP session。
- runtime stop 后再次 prompt resume。
- 同 agent 两 session 并发 prompt。
- session.cancel 不 kill runtime。

#### UI reducer

- lifecycle events 能生成/更新 pending assistant。
- 刷新后 pending permission/elicitation/tool/lifecycle 可还原。

### Step 12：文档同步

改动：

- `docs/architecture/acp-session-lifecycle.md`：补充两级回收和并发策略。
- `docs/architecture/ws-protocol.md`：补 lifecycle event。
- `docs/architecture/data-model.md`：补新增状态/字段/事件类型。
- `README.md`：如果新增环境变量，补运行说明。

验证：

- 文档和代码行为一致。

## 风险与注意点

1. **Codex closeSession 能力不完整**：不能把 close 失败当成致命错误；必须支持 best-effort disconnect。
2. **Claude 同 session 已有内部 queue，但平台仍限制同 session 单 active turn**：避免前端事件归并错乱。
3. **多 session 并发下 pending permission/elicitation 必须按 sessionId 隔离**：扫描 idle 时只要有 pending，就不能关闭对应 session/runtime。
4. **runtime 启动失败要清理 startPromise**：否则后续永远等待旧 promise。
5. **activeTurnCount 必须放在 finally 里归零**：否则 idle 回收会永久失效。
6. **session idle close 不等于删除对话**：不得清空 `sessions.acp_session_id`，不得删除 messages/events。
7. **不要引入 runtime 全局串行队列**：用户明确要求 Agent 多 session 并发。

## 推荐实施顺序

1. 先做 Step 2 + Step 3 + Step 4：解决新会话卡顿和懒连接。
2. 再做 Step 5 + Step 6：解决 prompt 阶段无反馈和多 session 并发。
3. 再做 Step 7 + Step 8：两级 idle 回收。
4. 最后做 Step 9 + Step 10 + Step 11 + Step 12：取消标准化、adapter 差异、测试和文档闭环。
