# ACP Session 生命周期

本文描述 Runtime 进程拥有 ACP 后的稳定职责、状态和数据流。

## 进程职责

```text
API 进程
  Session/Agent/Project 持久化
  RuntimeStateSnapshot 构建
  用户消息与最终消息投影
  Writer done barrier
        │ Runtime control IPC
        ▼
Runtime 进程
  ACP adapter 与 Agent 子进程
  每 Session 串行 actor
  capability / permission / elicitation / terminal
  streamGeneration + sequence
        │ stdio NDJSON
        ▼
Claude Code / Codex ACP
```

Realtime 是独立的数据面。Runtime 的可见 `session:update` 通过认证本机管道直接进入 Realtime；持久化 patch 和 done barrier 通过控制管道回到 API。

## 标识关系

平台 Session id 与 ACP Session id 是两个稳定标识：

```text
sessions.id               平台业务标识
sessions.acp_session_id   Agent runtime 的可恢复会话标识
```

Runtime 内存为每个 Agent 保存一个 ACP connection，为每个活动平台 Session 保存 ACP id、capability、偏好和 actor。一个 Claude/Codex ACP 进程可以承载同 Agent 的多个 Session；不同平台 Agent 保持独立 ACP 进程和环境。

API 重启或 Runtime 重启后，内存映射消失，但 SQLite 中的 `acp_session_id` 保留。下一次命令由 API 构建新快照，Runtime 优先调用 resume/load；运行时不支持恢复时才创建新 ACP Session，并由 API 回写新 id。

## 快照边界

`RuntimeStateSnapshot` 是 API 到 Runtime 的唯一领域输入，包含：

- Agent id、runtime、权限、配置和 system prompt
- Session id、项目、任务、工作目录、主会话标记和持久化 ACP id
- Runtime 命令、环境变量和模型档案生成的 Session meta
- MCP server DTO、Team 上下文和允许自动批准的内部工具名
- Session 级 model/mode/config 偏好

快照只含普通对象、数组和标量，可通过 `structuredClone`。Runtime 不读取 Store、SQLite 或 API 模块。

## 懒连接与 Prompt

创建平台 Session 只写 SQLite，不启动 ACP。第一次 prompt 或 capability 命令执行以下流程：

1. API 持久化用户消息并创建 running Agent message。
2. API 构建快照并调用 `RuntimePort.ensureSession`。
3. Runtime 启动或复用 Agent ACP 进程，resume/load/new ACP Session。
4. Runtime 应用保存的 model、mode 和 config。
5. Prompt 进入对应 Session actor；同一 Session 严格串行，不同 Session 可并行。
6. ACP update 经合并后分别进入可见流和持久化流。
7. Prompt 返回后 Runtime flush 两条流，发送 done barrier。
8. API 完成消息投影和 Writer critical commit 后确认 done。

## 流游标与合并

一次 Runtime 所有权周期对应一个 `streamGeneration`。`sequence` 只在输出逻辑 patch 时递增，不按原始 token 递增。文本 delta 按 Session + message 合并，思考与正文使用不同合并键；process item 按 item id latest-wins。权限、elicitation、终端终态和 done 会先 flush 同 Session 的普通更新。

可见流默认 25ms flush，直接到 Realtime。持久化流默认 250ms flush，回到 API 后标记为 `runtime-persistence`，Core 会做消息、事件和 process item 投影，但 Realtime event source 会忽略该来源，避免同一 patch 广播两次。

## 完成屏障

Runtime 不直接发布 `session:done`。done barrier 带最后的 generation/sequence，API 必须按 Session 等待此前所有持久化 patch，然后：

1. flush Session update batcher；
2. 完成 `messages` 与 `turn_process_items` 投影；
3. 通过 Writer 在一个事务中追加 `message.done` 和 Outbox；
4. 使用真实提交的 Session event sequence 作为 Outbox version；
5. 发出 `session:committed_done` 并确认 Runtime barrier。

浏览器收到 done 时，HTTP 消息历史和恢复事件已经可读。

## 交互与终端

权限和 elicitation 等待项属于 Runtime。API 只转发用户选择，不保存 Promise 或 ACP connection。Team 内部工具的自动批准集合由 API 根据工具可见性生成并放入快照，Runtime 不能自行查询权限表。

终端进程也属于 Runtime。默认资源配额为 32 个网络 turn、`max(2, floor(cpuCount / 2))` 个 CPU 型终端和 2 个磁盘型操作；等待者 FIFO 唤醒，Runtime 关闭时未获得配额的等待者会明确失败。

## 异常与回滚

Runtime 子进程异常退出不会关闭 API、HTTP、Writer、Query 或 Realtime。进行中的 Runtime request 明确失败，Session 主链路写入一条 error completion 并清理 active prompt；监督器重启 Runtime。新的 prompt 使用新 generation 和最新快照重新连接 ACP。

`RUNTIME_SERVICE_MODE=embedded` 使用 `EmbeddedRuntimePort` 包装旧 `acpHost`，用于显式排障回滚。process 模式运行中不会静默切换 embedded，避免双重 Session 所有权和重复输出。
