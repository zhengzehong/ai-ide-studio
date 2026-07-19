# AI IDE Studio 本地高并发性能架构设计

> 状态：待评审
>
> 日期：2026-07-19
>
> 目标：在单机本地部署下支持 30 个以上会话持续执行，同时保证页面查询、项目切换、浏览器刷新和实时流式输出互不阻塞。

## 1. 架构锚点

本设计先锚定以下决策。后续实施计划可以调整迁移顺序，但不得在未修改本设计的情况下改变这些边界。

### 1.1 最终物理形态只有三个业务进程

第一目标架构固定为三个 Node.js 业务进程：

1. **API Service**：所有 HTTP 读写、业务校验和 SQLite 数据访问。
2. **Realtime Service**：WebSocket 连接、订阅、背压和实时推送。
3. **Runtime Service**：ACP/MCP、Agent 生命周期、Session Actor、工具执行和流式合并。

另有一个轻量 **Supervisor** 负责启动、停止、迁移、健康检查和重启。Supervisor 不转发业务数据，不属于业务热路径。

### 1.2 Query 和 Command 逻辑分层，但不拆成两个进程

API Service 内部保留 Query/Command 边界：

- `GET/HEAD` 进入 Query。
- `POST/PUT/PATCH/DELETE` 进入 Command。
- Query 永久只读。
- Command 负责领域校验和状态变更。

二者初期运行在同一个 API 进程。只有 API 的实测指标达到扩容阈值时，才增加只读 Worker 或物理拆出 Query。

### 1.3 WebSocket 只承载实时通道

WebSocket 最终只处理：

- `connect`
- `subscribe`
- `unsubscribe`
- `resume`
- `ping/pong`
- 服务端事件推送

查询、表单、发送 Prompt、取消、已读、权限结果等领域操作全部走 HTTP。禁止以后重新向 WebSocket 添加复杂查询或同步领域 RPC。

### 1.4 SQLite 读写连接各有唯一所有者

API Service 内从第一版就运行两个 DB Worker Thread：

1. **Query Worker**：独占一个只读连接，启用 `query_only`。
2. **Writer Worker**：独占唯一读写连接，负责 Command、Runtime Batch 和 Outbox。

约束：

- API 主线程不直接调用 `better-sqlite3`。
- Runtime 不直接打开 SQLite。
- Realtime 不直接打开 SQLite。
- Query 通过 `QueryDataPort` 进入 Query Worker。
- Command 和 Runtime Persistence 通过 `WriteDataPort` 进入 Writer Worker。

两个连接访问同一个 WAL 数据库文件。该设计仍然只有一个 API 业务进程，但慢查询不会占用 Writer Worker，批量持久化也不会占用 Query Worker。后续只有读压力被证实为瓶颈时，才增加第二个 Query Worker。

### 1.5 Runtime 持久化不走 HTTP

Runtime 通过本地进程 IPC 调用 `PersistencePort`，不调用公开 HTTP API。

Node 第一版使用长度前缀 Protobuf 帧：

- Windows：Named Pipe。
- macOS/Linux：Unix Domain Socket。
- 测试和故障回退：loopback TCP。

HTTP 只存在于浏览器与 API Service 之间。

### 1.6 初始实例数全部为一

初始部署：

- API Service：1 个。
- Realtime Service：1 个。
- Runtime Service：1 个。
- Query Worker Thread：1 个。
- Writer Worker Thread：1 个。

不为预期之外的规模提前增加进程。每个边界从第一天支持替换和扩容，但是否扩容由指标决定。

### 1.7 Rust 通过替换服务引入，不做整体重写

服务间协议必须语言无关。后续某一部分撑不住时，可以保持协议不变，将对应 Node 实现替换为 Rust：

- Realtime：Axum/Tokio/Tower。
- Writer Worker 或独立 Writer：rusqlite。
- Query：Axum/SQLx。
- Runtime Stream Engine：Tokio Actor。

ACP/MCP Adapter 在 TypeScript SDK 仍更成熟时继续保留 Node。

## 2. 当前架构问题

### 2.1 HTTP、WebSocket 和数据库共享一个事件循环

当前 `src/gateway/server.ts` 在同一个 Node 进程中创建 HTTP Server 和 WebSocketServer。`src/gateway/ws-handler.ts` 在 WS `message` 回调中直接 dispatch RPC。

`src/store/db.ts` 使用同步 `better-sqlite3`。因此以下操作都会占用同一个 JS 主线程：

- HTTP 路由处理。
- WebSocket RPC。
- SQL 查询和事务。
- 大对象 JSON 解析和序列化。
- 流式事件映射和广播。

复杂 HTTP 查询会延迟 WS 推送；高频 Runtime 事件也会延迟静态资源和页面查询。

### 2.2 WebSocket 同时承担 Query、Command 和 Event

当前 WebSocket 既是查询总线，也是命令总线和实时事件通道。查询响应和流式事件竞争同一个回调、同一个序列化线程和同一个 socket 发送缓冲区。

该问题无法只靠增加 debounce 彻底解决，必须拆分协议职责。

### 2.3 Store 是同步且跨层耦合的

当前后端约有：

- 87 个 Store 文件。
- 44 个文件直接调用 `getDb()`。
- 71 个 Core/Gateway/ACP 文件引用 Store。
- 约 154 个 WS RPC Handler。

因此不能直接把某些文件复制到新进程。必须先建立异步 Port，再替换调用方。

### 2.4 Read Model 过重

已确认的热点包括：

- `tasks.list` 为每个 Task 继续查询 Session、Step 和 Progress。
- Session List 为每个 Session 追加运行态查询。
- 部分列表携带完整 Report、Tool 或 Event Payload。
- 项目激活无条件请求任务、Agent、会话、文件、知识库、规则和事件等多类数据。
- 页面组件在项目激活请求后再次触发重复请求。

进程拆分不会修复这些查询。Read Model 优化必须与架构拆分同时进行。

### 2.5 流式事件和持久化耦合

当前已经存在 Session Actor Scheduler 和 100/300ms 更新合并，但持久化最终仍同步发生在主进程。大量 `tool.update` 和大型 Payload 已使 `session_events` 达到百万级规模。

需要区分：

- 临时流式状态：允许合并、覆盖和重同步。
- 关键领域事件：必须持久化、幂等和按序提交。

## 3. 目标拓扑

```text
                              ┌──────────────────────┐
                              │      Supervisor      │
                              │ start/health/restart │
                              └──────────┬───────────┘
                                         │ control only
       ┌───────────────┐                 │
       │    Browser    │                 │
       └──────┬────────┘                 │
              │                          │
       HTTP   │                          │ WebSocket
              ▼                          ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│       API Service        │   │    Realtime Service      │
│                          │   │                          │
│ Query / Command / Auth   │   │ connection/subscription  │
│ static assets / uploads  │   │ sequence/backpressure    │
│                          │   │ no SQL / no domain RPC   │
│  ┌────────────────────┐  │   └────────────▲─────────────┘
│  │ Query DB Worker    │  │                │ stream IPC
│  │ read-only/query    │  │                │
│  ├────────────────────┤  │   ┌────────────┴─────────────┐
│  │ Writer DB Worker   │  │   │     Runtime Service      │
│  │ single RW/outbox   │◄─┼───│ session actors / ACP     │
│  └────────────────────┘  │   │ tools / stream coalesce  │
└──────────────────────────┘   └────────────┬─────────────┘
                                │ tools / stream coalesce  │
                                └────────────┬─────────────┘
                                             │ stdio/ACP
                                             ▼
                                 ┌────────────────────────┐
                                 │ Claude/Codex processes │
                                 └────────────────────────┘
```

## 4. 服务职责

### 4.1 Supervisor

负责：

- 选择 API、Realtime、Runtime 端口和 IPC Pipe 名称。
- 生成每次启动使用的内部 token。
- 在业务进程启动前运行数据库迁移。
- 按依赖顺序启动和停止进程。
- 收集 readiness/liveness。
- 独立重启异常子进程。
- 在关闭前请求 Runtime flush 和 Writer Worker checkpoint。

禁止：

- 转发 Runtime Stream。
- 转发 Persistence Batch。
- 维护 Session 业务状态。
- 作为通用消息总线。

### 4.2 API Service

负责：

- 静态资源和浏览器启动配置。
- HTTP 认证和项目作用域校验。
- Query：列表、详情、历史、搜索、统计和下载。
- Command：创建、修改、删除、已读、排序、发送、取消和权限确认。
- 文件上传和大 Payload 下载。
- 调用 Query/Writer DB Worker。
- 在数据库提交后产生 Domain Event/Outbox。
- 将 Runtime Command 发送到 Runtime Service。

禁止：

- 持有 WebSocket 订阅集合。
- 运行 ACP 或 Tool。
- 在主线程调用同步 Store。
- 持久化每一条原始 Token Delta。

API 内部目录保持 Query/Command 边界，但不物理拆分：

```text
api/
├─ query/
├─ command/
├─ auth/
├─ assets/
├─ runtime-client/
└─ data-client/
```

### 4.3 Query DB Worker Thread

负责：

- 独占一个 `better-sqlite3` 只读连接。
- 启用 SQLite URI `mode=ro` 和 `PRAGMA query_only=ON`。
- Prepared Statement 生命周期。
- 列表、详情、历史、搜索和统计 Read Model。
- Cursor Pagination、查询 Deadline 和结果体积预算。

所有查询按 `interactive`、`background` 两级排队。队列只能在一条同步 SQL 开始前调整优先级，不能中断已经运行的同步 SQL。因此禁止无界扫描进入交互路径。

### 4.4 Writer DB Worker Thread

负责：

- 独占唯一 `better-sqlite3` 读写连接。
- Command Transaction。
- Runtime Persistence Batch。
- Outbox 和 Durable Runtime Command 写入、读取和确认。
- WAL checkpoint 和维护任务。

写队列分三级：

1. `critical`：用户消息、权限结果、取消、Session Done。
2. `interactive`：表单 Command、已读和排序。
3. `background`：流式批次、统计投影、清理和 checkpoint。

领域校验中必须与写入保持原子性的读取，也在 Writer Worker 的事务中完成，不能先从 Query Worker 读取再无条件写入。

### 4.5 Realtime Service

负责：

- WebSocket 握手和短期 token 校验。
- Project/Session 订阅。
- 每个连接的有界发送队列。
- 每个 Session 的 sequence。
- 心跳、重连、gap detection 和 `resync_required`。
- Runtime Stream 和 API Domain Event 的推送。

禁止：

- 打开数据库。
- 执行领域 Command。
- 返回列表、历史、搜索结果。
- 接收大型 Tool Payload。

浏览器端通过 API 启动配置获取动态 WS Endpoint，禁止硬编码端口。

### 4.6 Runtime Service

负责：

- ACP/MCP Runtime 初始化和生命周期。
- Claude/Codex 子进程。
- 每 Session 串行 Actor。
- Prompt、Cancel、Permission 和 Tool 流程。
- 原始 ACP Event 规范化。
- UI Stream Coalescing。
- Persistence Batch Coalescing。
- CPU/磁盘重型 Tool 的并发治理。

禁止：

- 打开数据库。
- 承担浏览器 HTTP。
- 维护浏览器连接。
- 直接修改 API/Query Store。

## 5. 线程和事件循环模型

### 5.1 API Service

```text
API main event loop
├─ HTTP routing
├─ validation
├─ JSON response with size budget
├─ Runtime IPC client
└─ Query/Writer Worker MessagePort clients

Query Worker event loop
└─ synchronous read-only better-sqlite3

Writer Worker event loop
└─ synchronous read-write better-sqlite3
```

同步查询只阻塞 Query Worker，同步写入只阻塞 Writer Worker，二者都不阻塞 HTTP 主循环。

### 5.2 Realtime Service

```text
Realtime event loop
├─ WebSocket sockets
├─ subscription indexes
├─ outbound bounded queues
└─ stream/domain event IPC
```

该进程不允许同步 I/O 和大型 JSON 组装。

### 5.3 Runtime Service

```text
Runtime event loop
├─ session actors
├─ ACP stdio
├─ coalescing timers
└─ IPC writers

ACP/Tool child processes
└─ model adapters, terminal, build, test
```

第一阶段只有一个 Runtime 进程。后续分片时，每个 Shard 都是完整独立进程和事件循环。

## 6. 通信协议

### 6.1 浏览器协议

#### HTTP

- Query 使用 `GET/HEAD`。
- Command 使用 `POST/PUT/PATCH/DELETE`。
- 列表统一使用 Cursor Pagination。
- 大型内容通过 Detail/Download Endpoint 按需获取。
- 长任务返回 `202 Accepted + commandId`。
- 所有可重试 Command 支持 `Idempotency-Key`。

#### WebSocket

客户端帧只允许：

```text
connect
subscribe
unsubscribe
resume
ping
```

服务端帧包含：

```text
stream.patch
session.activity
session.done
task.changed
project.stats
domain.changed
resync_required
```

### 6.2 内部 IPC

内部热路径不使用 HTTP。统一 Envelope：

```text
version
kind
requestId
timestamp
deadlineMs
projectId
sessionId
sequence
payload
```

帧格式：

```text
4-byte big-endian payload length
protobuf envelope bytes
```

通道：

1. `api-runtime-command`：API -> Runtime。
2. `runtime-api-persistence`：Runtime -> API。
3. `runtime-realtime-stream`：Runtime -> Realtime。
4. `api-realtime-domain`：API -> Realtime。

Supervisor 仅向各进程发送 start/stop/drain 等控制消息，不中转以上通道。

### 6.3 背压规则

- IPC 和 WS 队列都必须有容量上限。
- `text delta` 可合并。
- 同一 Process Item 的进度采用 latest-wins。
- `permission`、`user message`、`cancel`、`done` 不可丢弃。
- `socket.write()` 返回 false 后停止继续写入，等待 `drain`。
- WS `bufferedAmount` 超限后停止增量发送并推送 `resync_required`。
- 客户端通过 HTTP Snapshot 恢复，不要求服务端无限保留事件。

## 7. 核心流程

### 7.1 页面查询

```text
Browser
  -> HTTP GET
  -> API Query
  -> Query Worker
  -> SQLite
  -> paged DTO
  -> Browser
```

### 7.2 普通表单

```text
Browser
  -> HTTP POST/PATCH/DELETE
  -> API Command validation
  -> Writer Worker transaction
  -> business row + outbox in one transaction
  -> HTTP 200/201
  -> API outbox dispatcher
  -> Realtime domain event
```

### 7.3 发送 Prompt

```text
Browser
  -> HTTP POST /sessions/:id/prompts
  -> API validation
  -> Writer Worker persists user message and durable runtime command
  -> API sends runtime command over IPC
  -> HTTP 202 { commandId }
  -> Runtime starts or resumes ACP
```

在用户消息和 Durable Runtime Command 提交成功前，不启动 ACP。API 的 Runtime Command Dispatcher 负责投递和确认，API 或 Runtime 重启后可从未确认命令继续投递。

### 7.4 流式输出

```text
ACP raw events
  -> Runtime Session Actor
  -> visible UI coalescer (16-33ms)
  -> Realtime IPC
  -> subscribed browser

Runtime Session Actor
  -> persistence coalescer (250-500ms)
  -> PersistenceBatch IPC
  -> API DataPort
  -> Writer Worker transaction
```

### 7.5 Session Done

```text
Runtime receives done
  -> flush persistence batch
  -> wait for DB commit ack
  -> emit session.done to Realtime
  -> release active turn and runtime resources
```

`session.done` 对外可见前，最终消息和关键状态必须已经提交。

### 7.6 页面刷新和重连

```text
Browser loads cached shell
  -> HTTP bootstrap/current project snapshot
  -> connect Realtime with lastSequence
  -> Realtime resumes if sequence retained
  -> otherwise resync_required
  -> Browser fetches HTTP snapshot
```

Realtime Event 不是永久历史。HTTP Snapshot 是恢复真源。

## 8. 30 会话容量模型

假设 30 个会话每秒各产生 20 条原始 Delta：

```text
raw input: 30 * 20 = 600 events/s
```

Runtime 在进程内合并：

- 可见会话 UI：最多每 16-33ms 一次 Patch。
- 后台会话 UI：每 100-250ms 推 Activity/Progress 摘要，不推正文。
- Persistence：每 Session 每 250-500ms 一次 Batch。

目标输出规模：

- Runtime -> Realtime：当前可见会话完整流，后台会话低频摘要。
- Runtime -> API：约 60-120 个逻辑 Batch/s，Writer Worker 再合并为少量事务。
- Browser 不订阅的 Session 不接收正文 Patch。

30 个 LLM 会话可以并行；30 个同时执行 build/test 的 CPU/磁盘重任务不能无限并行。Runtime 必须按资源类型维护 Semaphore：

- LLM/network turn：允许 30+。
- CPU-heavy tool：默认 `max(2, floor(logicalCpu / 2))`。
- Disk-heavy tool：默认 2。
- Maintenance：系统高负载时暂停。

## 9. 数据模型和一致性

### 9.1 数据库真源

- 已提交领域状态以 SQLite 为真源。
- Runtime 内存状态只代表当前执行。
- Realtime 内存状态只代表当前连接和短期序列。
- 前端缓存均为可失效 Snapshot。

### 9.2 Transactional Outbox

API Command 在一个事务中写入：

1. 业务表。
2. `outbox_events`。

Outbox Dispatcher 在提交后将事件推给 Realtime。推送成功后标记已发送。API 崩溃重启后可继续投递，避免“数据库成功但 UI 永远不知道”。

高频 Token Delta 不进入 Outbox，只保留最终消息、关键过程状态和可恢复 Snapshot。

### 9.3 版本和幂等

- Command 使用 `commandId`/`Idempotency-Key` 去重。
- Entity Domain Event 携带 `version`。
- Session Stream 携带单调递增 `sequence`。
- 客户端忽略旧 version，发现 sequence gap 时重新 Query。

## 10. 故障和降级

### 10.1 API Service 失败

- 页面 Query 和 Command 暂时不可用。
- Realtime 已建立连接可继续接收 Runtime 临时流。
- Runtime 的非关键 Persistence Batch 在有界队列内等待。
- 队列达到上限后暂停新 Turn，不丢关键消息。
- Supervisor 重启 API 后恢复提交。

### 10.2 Realtime Service 失败

- Runtime 继续执行并持久化。
- 浏览器重连失败时显示离线状态。
- Realtime 恢复后通过 sequence/resync 重新取得 Snapshot。

### 10.3 Runtime Service 失败

- API 和历史查询保持可用。
- Supervisor 将 Active Session 标记为 interrupted。
- ACP 子进程被清理或重新接管。
- Runtime 重启后根据持久化状态恢复或明确结束 Turn。

### 10.4 Query Worker 失败

- HTTP Query 返回 503 或前端显示最后可用 Snapshot。
- Writer Worker、Runtime 和 Realtime 继续工作。
- Supervisor 只重启 Query Worker，不中断 Writer。

### 10.5 Writer Worker 失败

- API 拒绝新的变更 Command，返回 503。
- Query Worker 仍可提供已经提交的数据。
- Runtime 暂停需要持久化保证的新 Turn。
- 禁止在 Writer 不可用时继续无限缓冲。

## 11. 可观测性和性能门禁

每个请求和事件必须携带：

```text
requestId
projectId
sessionId
turnId
commandId
sequence/version
```

必须采集：

- 每个 Node 进程的 event-loop lag 和 eventLoopUtilization。
- IPC queue depth、queue wait 和 payload bytes。
- Query/Writer Worker 各自的 queue depth、queue wait、SQL time、transaction time 和 WAL size。
- Runtime raw/coalesced event counts。
- WS outbound queue、bufferedAmount 和端到端延迟。
- Browser Long Task、首次可交互时间和路由切换时间。

发布门禁：

- 缓存项目/页面切换 `< 50ms`。
- 浏览器硬刷新可交互 `< 300ms`。
- Session History p95 `< 100ms`。
- Runtime Event 到浏览器 p95 `< 50ms`。
- Realtime event-loop lag p99 `< 20ms`。
- 30 个会话持续流式 30 分钟，无超时、无持续内存增长。
- 注入一个 2 秒慢 Query 时，WS p95 仍 `< 50ms`。

## 12. 扩容和 Rust 替换阈值

### 12.1 API/Query

保持一个 API 进程，先优化 SQL、分页和 DTO。只有满足以下任一条件才增加只读 Worker：

- Query Worker Queue p95 持续超过 50ms。
- API CPU 持续超过 70%。
- 长搜索/报表影响普通页面查询。

Query Worker 是无状态的，使用 least-inflight 分配，不使用 Session 粘性。

### 12.2 Runtime

第一阶段保持一个 Runtime。满足以下任一条件才分片：

- Runtime CPU 持续超过 70%。
- Runtime event-loop lag p99 超过 20ms。
- GC pause p99 超过 20ms。
- 单 Session 流量导致其他 Session 明显延迟。

分片后默认 2，最多先扩到 4。Active Session 使用 Runtime Lease 粘到固定 Shard，运行中不迁移。

### 12.3 Rust 替换

Rust 替换不是第一阶段前置条件。替换优先级按指标决定：

1. Realtime：连接、序列化或背压成为瓶颈。
2. Writer Worker：写队列和内存稳定性成为瓶颈。
3. Query Worker：SQL 已优化但 CPU/序列化仍超标。
4. Runtime Stream Engine：Node 分片后仍有 GC/CPU 问题。
5. ACP Adapter：最后考虑。

替换方式：

- 保持 Protobuf Envelope 和 Port 语义不变。
- Node 与 Rust 双跑 Shadow Read/Shadow Event 校验。
- 按服务 Feature Flag 切换。
- 不进行数据库双写。
- 任一服务可立即回退 Node 实现。

## 13. 迁移路线

迁移采用绞杀式方式，不进行 Big Bang 重写。

### 阶段 0：基准和契约

- 固定 PRD 源码与运行产物版本。
- 建立 30 Session Mock Stream + 慢 Query 压测。
- 定义 HTTP DTO、IPC Envelope 和 Port。
- 在单体内提供 In-Process Adapter。

### 阶段 1：HTTP 化和 Read Model 优化

- UI Query/Command 从 WS RPC 迁到 HTTP。
- WS 只保留 Event 和兼容桥。
- 重写 Task/Session/History 热点查询。
- 路由按需加载，取消项目级全量预取和重复 Fetch。
- 增加 Cursor、响应体积预算和 Detail Endpoint。

### 阶段 2：Query/Writer Worker Thread

- `better-sqlite3` 移入一个只读 Query Worker 和一个读写 Writer Worker。
- Store 调用逐域迁到异步 DataPort。
- 建立优先级队列、Batch Transaction 和 Outbox。
- 主线程禁止直接 import `getDb()`。

### 阶段 3：Realtime 进程

- 从现有 Gateway 提取连接、订阅和广播。
- 接入 Runtime/API IPC Event。
- UI 使用动态 WS Endpoint。
- 删除领域 WS RPC，只保留兼容开关。

### 阶段 4：Runtime 进程

- ACP Host、Session Actor、Tool Runtime 迁入独立进程。
- Core Session 流程改用 PersistencePort/EventSink。
- 接入 Resource Governor 和有界队列。
- 故障时支持 interrupted/resume。

### 阶段 5：性能收口

- IndexedDB 保存最近项目和会话 Snapshot。
- Route-level code splitting 和静态资源长期缓存。
- 数据库历史归档、索引核查和受控 checkpoint。
- 完成 30 Session 长稳和 Kill/Restart 测试。

## 14. 代码边界建议

目标目录结构：

```text
src/
├─ supervisor/
├─ api/
│  ├─ query/
│  ├─ command/
│  ├─ auth/
│  └─ assets/
├─ realtime/
├─ runtime/
│  ├─ actors/
│  ├─ acp/
│  ├─ streams/
│  └─ resources/
├─ data-worker/
│  ├─ query-worker/
│  └─ writer-worker/
├─ contracts/
│  ├─ http/
│  └─ ipc/
├─ ports/
│  ├─ data-port.ts
│  ├─ persistence-port.ts
│  ├─ runtime-port.ts
│  └─ event-sink.ts
└─ shared/
```

迁移期间现有模块可以通过 Adapter 继续工作，但新增代码必须遵守以下依赖方向：

```text
API/Runtime/Realtime -> Ports/Contracts
Adapters -> Store/IPC/HTTP
Domain <- no transport or database dependency
```

## 15. 非目标

第一目标架构不做：

- Query 和 Command 独立进程。
- 默认多个 API/Runtime 实例。
- Redis、Kafka、NATS 或 Kubernetes。
- 多个 SQLite Writer。
- 全量 Rust 重写。
- 逐 Token 永久事件存储。
- 为性能改造重做业务状态机。

## 16. 预估工作量

完整迁移预计 10-14 周：

- 阶段 0：3-5 天。
- 阶段 1：2-3 周。
- 阶段 2：3-4 周。
- 阶段 3：1-2 周。
- 阶段 4：3-4 周。
- 阶段 5：1-2 周。

部分阶段可并行，但 DB Port、Realtime 协议和 Runtime 所有权必须按顺序落地。

## 17. 最终结论

AI IDE Studio 的第一目标不是微服务化，也不是立即 Rust 化，而是把三类互相冲突的负载放进三个独立事件循环：

```text
API Service      = HTTP + Query/Command + Query/Writer DB Workers
Realtime Service = WebSocket + Subscription + Backpressure
Runtime Service  = ACP + Session Actor + Tool + Stream Coalescing
```

该架构以最少的进程数量消除 HTTP/DB、实时连接和 Agent Runtime 之间的事件循环阻塞；同时通过语言无关 Port 和 IPC 合约，为后续逐服务替换 Rust 保留稳定边界。
