# AI IDE Studio — 架构审查报告

> 审查日期：2026-06-04

---

## 目录

1. [关键发现一览](#1-关键发现一览)
2. [关键问题 (Critical)](#2-关键问题-critical)
3. [高风险问题 (High)](#3-高风险问题-high)
4. [中等风险问题 (Medium)](#4-中等风险问题-medium)
5. [低风险问题 (Low)](#5-低风险问题-low)
6. [改进建议](#6-改进建议)

---

## 1. 关键发现一览

| # | 问题 | 严重度 | 涉及主要文件 |
|---|------|--------|-------------|
| 1 | 模块级可变单例遍布项目 | **Critical** | 几乎全部 `src/` |
| 2 | 事件总线无生命周期管理 | **Critical** | `core/events.ts`, `gateway/ws-handler.ts` |
| 3 | 架构分层被打破，各层相互直接引用 | **Critical** | 横跨 `gateway/` `core/` `store/` `acp/` `tools/` |
| 4 | 两套 Turn 跟踪系统可能失步 | **Critical** | `core/sessions.ts`, `acp/host-state.ts`, `gateway/rpc/sessions.ts` |
| 5 | RPC 层无任何输入验证 | **High** | `gateway/rpc/*`, `gateway/ws-handler.ts` |
| 6 | Promise 队列错误静默吞噬 | **High** | `core/sessions.ts` |
| 7 | 启动顺序隐含竞态 | **High** | `app.ts`, `entry.ts` |
| 8 | 规则引擎无并发控制 | **Medium** | `core/rules.ts` |
| 9 | 硬编码中文 stage 字符串 | **Medium** | `store/sessions.ts` |
| 10 | Team dispatch 队列无上限 | **Medium** | `core/team-member-dispatcher.ts` |
| 11 | 无统一错误处理策略 | **Medium** | 遍布各层 |
| 12 | PendingTurn 无大小限制 | **Medium** | `core/turn-finalizer.ts` |
| 13 | RPC 超时直接修改 ACP 内部状态 | **Medium** | `gateway/rpc/sessions.ts` |
| 14 | 死代码/空实现未清理 | **Low** | `tools/resolver.ts`, `core/sessions.ts` |

---

## 2. 关键问题 (Critical)

### 2.1 模块级可变单例状态

**问题描述**

整个应用依赖模块级可变单例。每个 store、service、状态容器都声明为模块级 `const`/`let` 并被直接修改。

**具体实例**

| 文件 | 行号 | 代码 | 说明 |
|------|------|------|------|
| `src/store/db.ts` | 23-24 | `let _db: SqliteDatabase \| null = null` | 数据库连接是单例，无法为测试创建隔离实例 |
| `src/acp/host-state.ts` | 6 | `export const agentConnections = new Map<...>()` | 全局 Map 跟踪所有活跃 Agent 子进程 |
| `src/acp/interaction-state.ts` | 6-7 | `pendingPermissions = new Map()`, `pendingElicitations = new Map()` | 全局可变 Map |
| `src/core/sessions.ts` | 26-28 | `pendingBySession`, `activePrompts`, `queuedPrompts` | 跟踪所有活跃 prompt 的模块级状态 |
| `src/core/rules.ts` | 11-13 | `let _timer`, `let _lastMinute`, `_firedThisMinute` | 规则引擎的 tick 定时器是模块级 |
| `src/acp/client-handler.ts` | 19-20 | `turnsByAgent = new Map()` | 全局 Map 跟踪 ACP 客户端 turn |
| `src/acp/host.ts` | 36-37 | `startPromises`, `cancelledSessions` | 模块级可变状态 |
| `src/core/team-member-dispatcher.ts` | 16-17 | `activeMemberSessions`, `pendingByMemberSession` | 团队调度队列状态 |
| `src/gateway/ws-handler.ts` | 11 | `const clients = new Map()` | 全局 WebSocket 连接 Map |

**风险**

- 无法为测试创建隔离的应用实例
- 测试不能并行运行
- 启动/关闭序列会跨调用泄漏状态
- 如果 `sendPrompt` 过程中发生错误，`activePrompts` 的 `finally` 块虽然清理了 Set，但若 Promise 被遗弃或进程崩溃，状态泄漏

**建议**

引入显式的依赖注入或服务容器模式。将每个有状态模块包装为可实例化的类，创建一个 `AppContext` 对象贯穿调用链。

---

### 2.2 事件总线无生命周期管理

**问题描述**

`core/events.ts` 导出一个全局 `mitt` 实例，各层都导入它并在模块加载时注册监听器，但从没有任何地方调用 `off()` 清理。

**具体实例**

- **`src/core/events.ts`**: `export const events = mitt<AppEvents>()` — 单例事件总线
- **`src/core/sessions.ts:30,44,70,88,93`**: 在模块作用域注册事件监听器
- **`src/gateway/ws-handler.ts:41-104`**: 在模块作用域注册事件监听器
- **`src/core/team-member-dispatcher.ts:19`**: 在模块作用域注册事件监听器

**风险**

- `ws-handler.ts` 在模块 import 时注册监听器。WebSocket 连接关闭后监听器依然存在
- 测试 import 这些模块会累积重复监听器
- 同一进程中运行多个服务实例（测试场景）会产生重复事件投递

**建议**

(a) 从事件注册返回 unsubscribe 函数并在清理时调用；(b) 或将事件总线生命同期限制到连接/会话级别。

---

### 2.3 架构分层被打破

**理想分层**

```
gateway → core → store
acp → core
```

**实际依赖关系（存在大量跨层引用）**

| 源层 | 目标层 | 示例文件 |
|------|--------|----------|
| `store/` | `core/` | `store/sessions.ts` 引用 `core/logger.js` |
| `acp/` | `store/` | `acp/host.ts` 引用 `store/agents.js` |
| `gateway/` | `acp/` + `core/` + `store/` | `rpc/sessions.ts` 引用所有三层 |
| `core/` | `store/` | `core/sessions.ts` 引用 `store/sessions.js` |
| `core/` | `tools/` | `core/sessions.ts` 引用 `tools/registry/visibility-resolver.js` |
| `tools/` | `store/` + `core/` | `resolver.ts`/`tool-gateway.ts` 引用两者 |

**风险**

- 全连接依赖图，任何对 `store/` 的修改都可能影响所有模块
- "业务逻辑层" (`core/`) 与 SQLite 存储、事件总线、ACP 传输层紧密耦合
- 无法在不改写业务逻辑的前提下替换存储实现

**建议**

为 store 层定义 TypeScript 接口。`core/` 应依赖接口而非具体实现。`gateway/` 应只依赖 `core/` 的服务接口。`store/` 实现这些接口。

---

### 2.4 两套独立的 Turn 跟踪系统可失步

**问题描述**

存在两套独立系统跟踪一个会话是否处于活跃 turn：

1. **`src/core/sessions.ts:27`**: `activePrompts = new Set<string>()` — 核心层跟踪
2. **`src/acp/host-state.ts:68-75`**: `beginTurn()` / `endTurn()` — ACP 连接层通过 `activeTurnCount` 跟踪

**失步风险点**

- `sessionManager.sendPrompt()` (line 157) 只检查 `activePrompts`，不检查 `activeTurnCount`
- `gateway/rpc/sessions.ts:144-145` 的 cancel 超时处理直接修改 `conn.activeTurnCount` 和 `rs.activeTurnCount`，完全绕过 `endTurn()`
- 如果 `endTurn()` 在超时后也被调用（例如 ACP 进程最终停止，`proc.on('exit')` 触发），计数器会变成负数

**建议**

合并到单一跟踪点。`acp/host-state.ts` 的计数器应作为唯一事实来源。将 cancel 超时逻辑移到 `acpHost` 内部，暴露 `forceEndTurn()` 方法。

---

## 3. 高风险问题 (High)

### 3.1 RPC 层无任何输入验证

**位置**: `src/gateway/rpc/*.ts`, `src/gateway/ws-handler.ts`

**问题**: 所有 RPC handler 使用 `msg.xxx as string` 的无检查类型断言。`ws-handler.ts:126` 只做了 `JSON.parse`，没有任何 Zod 或 schema 验证。

```typescript
// ws-handler.ts:126
msg = JSON.parse(raw.toString())  // 唯一解析，无 schema 验证

// rpc/sessions.ts:39-41 — 每个 handler 都有类似代码
const sessionId = msg.sessionId as string   // 可静默返回 undefined
const modelId = msg.modelId as string
```

**影响**: 恶意或错误的消息可以产生 `undefined` 参数，导致不可预测的行为或崩溃。

---

### 3.2 Promise 队列错误静默吞噬

**位置**: `src/core/sessions.ts:168-185`

```typescript
const next = previous
  .catch(() => undefined)
  .then(async () => {
    while (activePrompts.has(sessionId)) await waitForIdleTurn()
    // ...
    await sendPromptNow(session, content, images)
  })
queuedPrompts.set(sessionId, next)
next
  .finally(() => { /* cleanup */ })
  .catch(() => undefined)  // ← 错误被静默吞噬
```

**问题**: 第 183 行的 `.catch(() => undefined)` 使得队列中的任何错误完全不可见。`sendPromptNow` 如果 throw，错误被第 171 行的 `.catch(() => undefined)` 捕获并解析为 `undefined`，链继续。这使得调试队列失败极其困难。

---

### 3.3 启动顺序隐含竞态

**位置**: `src/app.ts`, `src/entry.ts`

**问题**:
- `app.ts:29-35`: `reconcileInterruptedStages()` 在 `startGateway()` 之前运行
- 但 `ws-handler.ts` 的事件监听器在模块 import 时（`gateway/server.js` 被 import 时）就已注册
- `ruleEngine.start()` 在 `startGateway()` 之后（line 42）调用，但其定时器异步触发，若 WebSocket 未完全就绪则产生空广播
- `entry.ts:7-8`: `.env` 缺失时无错误，应用以可能不完整的配置启动

---

## 4. 中等风险问题 (Medium)

### 4.1 规则引擎无并发控制

**位置**: `src/core/rules.ts:117-143`

30 秒一次的 tick 中，`executeRule()` 调用 `taskManager.createTask()`，继而调用 `sessionManager.sendPrompt()` 是 fire-and-forget。若多个规则同时匹配，可能累积大量并发 prompt 操作。

### 4.2 硬编码中文 stage 字符串

**位置**: `src/store/sessions.ts:56-64`

```typescript
const RUNNING_STAGES = [
  '正在处理...',
  '正在思考...',
  '正在准备 Agent...',
  '正在执行...',
  // ...
]
```

新增 stage 时若忘记更新列表，崩溃恢复将失效。应使用布尔 `is_running` 列替代。

### 4.3 Team dispatch 队列无上限

**位置**: `src/core/team-member-dispatcher.ts:17`

`pendingByMemberSession` Map 可无限增长。若团队成员持续忙碌，`dispatchMemberPrompt` 会无限堆积条目。

### 4.4 无统一错误处理策略

错误处理方式在各层各不相同：
- 有的 throw
- 有的 return
- 有的 emit 事件
- 有的 catch 后静默
- 无结构化错误代码 / 分类 / 传播模式

### 4.5 PendingTurn 无大小限制

**位置**: `src/core/turn-finalizer.ts`

`PendingTurn` 对象的 `finalAnswer`、`thinking`、`toolCalls` 无最大限制。恶意 agent 可发送无限内容导致 OOM。

### 4.6 RPC 超时直接修改 ACP 内部状态

**位置**: `src/gateway/rpc/sessions.ts:138-148`

```typescript
setTimeout(() => {
  rs.activeTurnCount = 0
  conn.activeTurnCount = Math.max(0, conn.activeTurnCount - 1)
  // ...
}, 10_000)
```

Gateway 层直接修改 ACP 层的内部计数器，绕过 `endTurn()`。若 ACP 超时后自然完成，则状态被双重修改。

### 4.7 JSON.parse 无异常保护

**位置**: `src/tools/resolver.ts:25-30`, `src/tools/types.ts`

多处 `JSON.parse(row.config_json)` 无 try/catch。若存储的 JSON 损坏，整个 tool 解析过程会崩溃，影响所有工具执行。

### 4.8 `proc.stdio` 非空断言

**位置**: `src/acp/host.ts:147,152-153`

```typescript
proc.stderr!.on('data', ...)
const input = Writable.toWeb(proc.stdin!) as ...
const output = Readable.toWeb(proc.stdout!) as ...
```

若 `spawn` 因平台配置异常未能产生 stdio 流，运行时直接抛出。

---

## 5. 低风险问题 (Low)

### 5.1 死代码：注释掉的旧函数

**位置**: `src/tools/resolver.ts:223-263`

41 行注释掉的 `oldResolveToolsAsMcpServers` 函数，为旧版本实现，应删除。

### 5.2 空实现：sendDecision

**位置**: `src/core/sessions.ts:187`

```typescript
async sendDecision(sessionId: string, _messageId: string, _choice: string): Promise<void> {
  const session = sessionStore.get(sessionId)
  if (!session) throw new Error(`Session 不存在: ${sessionId}`)
  // TODO: implement ACP decision forwarding
},
```

被 CLI 调用但不产生效果，验证会话是否存在后直接返回。

### 5.3 emitLifecycle 多余 DB 读取

**位置**: `src/core/sessions.ts:350-359`

`updateStage` 后再次调用 `sessionStore.get(sessionId)` 读取刚更新过的记录，造成不必要的 I/O。

### 5.4 Mock Connection 每次返回新的 AbortController

**位置**: `src/acp/host.ts:631`

```typescript
get signal() {
  return new AbortController().signal
},
```

若 ACP SDK 缓存 signal 并期望稳定引用，此实现会引发问题。同时产生未释放的 AbortController。

### 5.5 `jsonSchemaPropsToZodShape` 无法处理复杂 schema

**位置**: `src/tools/tool-gateway.ts:113-133`

不支持 `anyOf`、`oneOf`、`allOf`、`$ref`、`nullable`、嵌套对象。未知 type 默认降级为 `z.string()`，静默丢失类型安全。

---

## 6. 改进建议

### 短期 (可快速修复)

| # | 操作 | 预计工作量 |
|---|------|-----------|
| 1 | 删除 `resolver.ts:223-263` 注释死代码 | 5 分钟 |
| 2 | 在 `JSON.parse` 处加 try/catch（`resolver.ts`、`types.ts`） | 30 分钟 |
| 3 | 补充 `sendDecision` 实现或标记为废弃 | 15 分钟 |
| 4 | `proc.stdio!` 改为带 guard 的安全访问 | 15 分钟 |
| 5 | 合并 `emitLifecycle` 中多余的 `get()` 调用 | 10 分钟 |

### 中期 (1-3 天)

| # | 操作 |
|---|------|
| 1 | 在 `ws-handler.ts` 引入 Zod schema 验证网关 RPC 输入 |
| 2 | 为事件总线注册提供生命周期管理，连接关闭时 `off()` |
| 3 | 添加统一错误类型 `AppError` 层次结构和全局错误边界 |
| 4 | 修复 Promise 队列错误吞噬问题，添加 visible rejection handler |
| 5 | 取消超时处理逻辑移到 `acpHost` 内部，提供 `forceEndTurn()` |

### 长期 (1-2 周)

| # | 操作 |
|---|------|
| 1 | 引入 DI/容器模式，将模块级单例重构为可实例化类 |
| 2 | 为 `store/` 层定义接口，使 `core/` 依赖接口而非具体实现 |
| 3 | 合并 turn 跟踪系统，统一事实来源 |
| 4 | 添加运行时长 / 内容使用上限（PendingTurn、dispatch 队列） |
| 5 | 规则引擎添加信号量控制并发 |