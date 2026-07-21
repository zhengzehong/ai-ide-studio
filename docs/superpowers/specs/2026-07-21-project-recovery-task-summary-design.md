# Project Recovery 与 Task 摘要加载设计

## 目标

在不改变用户功能的前提下，修复 PC 项目切换偶发空白和远程访问时消息需要数秒才出现的问题，并收缩 Workspace 高频加载的 Task 列表。

本设计分两个交付批次：

1. 修复项目作用域、加载状态和 Session 恢复大包。
2. 将 Task 列表改为摘要数据，完整内容按需加载。

所有开发在 `fix/project-recovery-task-summary` 分支完成。未经审查和用户确认，不合并 `prd`，不重启 18900。

## 功能兼容合同

### 工具调用

- 工具执行期间的 Realtime 事件继续实时展示。
- 已完成工具的完整输入和输出继续保存在现有存储中。
- Session 初次打开或断线恢复不再批量下载历史完整 `tool.call`、`tool.update`、`message.chunk` 和 `thinking.chunk`。
- 工具卡片首屏保留工具名称、状态、输入预览、输出摘要和 `hasDetail`。
- 输入优先保留可识别信息，例如命令、文件路径和参数结构。
- 完整输入输出仍通过现有工具详情或过程详情接口按需加载。
- 文件修改、权限审批、elicitation、工具审计和历史详情功能不变。

### 对话恢复

- 消息正文以 `messages` 为首屏数据源。
- 正在运行的 Agent 消息由 running message 和 `turn_process_items` 摘要恢复。
- Session 状态恢复保留 capabilities、usage、turn usage、plan、pending permission、pending elicitation 和最新 event cursor。
- 恢复失败必须显示可重试状态，不得静默表现为空会话。

### Task

- Task 列表保留标题、状态、阶段、负责人、步骤进度、时间和短预览。
- Task 列表不再携带完整 description、完整步骤报告或历史事件正文。
- 打开 Task 详情时加载完整 description、步骤详情和报告。
- TaskBoard、Workspace 右栏和任务协作流程保持原有功能。

## 批次一：项目与 Session 恢复

### 项目激活边界

`activateProjectData(projectId)` 分成两个职责：

- **视图激活**：每次路由导航都执行所有项目作用域 Store 的 `activateProject(projectId)`。
- **后台刷新**：相同项目正在进行的 refresh Promise 可以复用，避免重复网络请求。

不得因为 refresh 已在进行而跳过视图激活。A 项目刷新中执行 A -> B -> A 时，最终所有 Store 的 active scope 必须是 A；A 的 refresh 只发起一次。

### 加载状态

Agent、Session 和消息采用一致的三态模型：

- `initialLoading`：目标作用域没有可展示缓存，正在首次加载。
- `refreshing`：已有缓存可展示，后台刷新中。
- `error`：最近一次加载失败，保留已有数据并允许重试。

界面规则：

- `initialLoading=true` 时显示加载态，不显示“暂无智能体/暂无会话”。
- 只有一次请求成功返回空数组后才显示真实空状态。
- 有缓存刷新失败时继续展示缓存，并提供轻量错误提示和重试。
- 无缓存加载失败时显示明确错误和重试按钮。
- 消息加载失败不得被空 catch 吞掉。

项目缓存必须能在没有既有 entry 时保存请求错误。`Promise.allSettled` 可以保留不同域的故障隔离，但调用方必须能观察各 Store 的失败状态。

### Recovery 数据流

正常选择 Session：

1. 立即切换 Session，并显示内存消息缓存或消息加载态。
2. 请求最近 20 条 messages。
3. 如果存在 running agent message，请求该 message 的 process summary。
4. 请求轻量 recovery state。
5. 完整工具详情仅在用户展开时请求。

Realtime gap：

1. 当前 Session 的 messages 和 recovery state 为高优先级请求。
2. 目标项目的 Agent/Session 精准失效与刷新继续执行。
3. Task、文件树、知识库等项目后台刷新不得阻塞消息首屏。
4. recovery 完成后再 acknowledge resync。

### Recovery 接口

新增面向页面恢复的轻量查询，不复用原始审计事件列表作为 UI snapshot。响应概念字段：

- `sessionId`
- `latestSequence`
- `usage`
- `turnUsage`
- `capabilities` 或可补齐 capabilities 的最小状态
- `plan`
- `pendingPermissions`
- `pendingElicitations`
- `activeTurn`

`activeTurn` 只包含 message id、状态和过程摘要引用，不包含完整工具输出、图片 base64 或终端全文。

旧的 `/events` 分页接口继续保留给兼容路径、诊断和按 message 查询，但 PC 首屏恢复不再请求最近 1000 条原始事件。

### Recovery 状态来源

优先沿用现有数据，不在本批次引入大规模存储迁移：

- messages：`messages`
- active process summary：`turn_process_items` 的非 detail 列
- capabilities：Runtime capabilities 查询与轻量状态事件
- usage/plan/interactions/cursor：服务端从必要事件投影为 recovery DTO

服务端投影可以读取必要事件类型，但不得把完整 mirrored events 返回浏览器。后续单份存储改造独立实施。

### 性能预算

- Session messages 首屏默认 20 条。
- Recovery 响应目标小于 128 KiB，硬性测试预算 256 KiB。
- Recovery 响应不得包含 `tool.update`/`tool.call` 的完整 raw input/output、图片 base64 或终端全文。
- 项目恢复不得让 Task 请求阻塞当前 Session 消息显示。

## 批次二：Task 摘要与详情

### Task Summary

Task 列表查询返回 `TaskListItem` 摘要：

- Task 基础标识和路由所需字段
- title、status、stage、assignee
- created/completed 时间
- sessionId
- stepProgress
- 步骤最小摘要：id、title、status、assignee、sessionId、dependsOn、currentStage
- descriptionPreview
- latestReportPreview、latestReportAt、latestReportType

列表不返回完整 `description`。`descriptionPreview` 在服务端按字符上限生成，不能由浏览器收到全文后再截断。

### Task Detail

Task 详情查询返回：

- 完整 Task 字段和 description
- 步骤详情
- 当前页面需要的报告/历史数据

详情 Store 按 taskId 缓存，支持 loading、error 和 retry。列表实时事件继续更新摘要字段；详情打开期间收到变更时，更新摘要并使详情缓存失效或合并对应字段。

### 兼容策略

- WS 写操作仍返回完整 Task 时，Store 可以同时更新摘要缓存和详情缓存。
- HTTP Task list 使用摘要 DTO。
- 现有依赖 `description` 的详情组件改为显式读取 detail 状态。
- 不修改 Task 创建、派发、步骤状态机和报告写入协议。

### 性能预算

- 当前项目 262 条 Task 的列表响应目标低于 512 KiB。
- Task list 不得包含完整 description 或完整报告正文。
- 打开 Task 详情只请求一个 taskId 的数据。

## 错误处理

- 所有新 HTTP 查询保持明确的 400/503/504/500 语义。
- 前端区分首次加载失败和后台刷新失败。
- Session recovery 失败不清除已经显示的 messages。
- Task detail 失败不清空 Task summary。
- 切换项目或 Session 后，迟到响应只能写入对应缓存，不能覆盖当前可见作用域。

## 测试策略

### 项目作用域

- A refresh pending -> B -> A：最终 active scope 为 A。
- 同一 A 的 refresh 只执行一次。
- 冷缓存 loading、成功空结果、失败重试分别显示正确状态。
- 迟到的 B 响应不覆盖 A。

### Session recovery

- messages 在 recovery/项目后台刷新未完成时即可显示。
- completed tool raw output 不出现在 recovery 响应。
- tool input preview 和 process summary 保留。
- 展开工具详情仍返回完整输入输出。
- running message 通过 process summary 恢复工具状态。
- permission/elicitation/plan/capabilities/cursor 恢复正确。
- oversized tool event 数据下 recovery 响应仍满足预算。

### Task

- Task list 不返回完整 description。
- Task detail 返回完整 description。
- Workspace 和 TaskBoard 打开详情后内容完整。
- Task 写操作和事件更新保持摘要/详情一致。
- 262 条规模的响应满足预算。

### 全量验证

- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 独立端口和独立 DATA_DIR 的浏览器验证，不使用 18900 和 data-prd

## 非目标

- 本次不删除或重写 PRD 历史工具输出。
- 本次不压缩现有 3.7GB 数据库。
- 本次不迁移大工具输出到新 blob 表。
- 本次不改变工具执行、Realtime 实时流或 Runtime 所有权。
- 本次不修改移动端，除非共享类型编译需要兼容调整；不得改变移动端行为。

## 交付与回滚

- 两批分别形成独立提交，第一批内部可再拆为项目状态与 recovery 两个提交。
- 新 recovery 接口上线时保留旧 events 接口，回滚前端即可恢复旧路径。
- Task detail 上线前保留现有写操作返回结构。
- 数据库无破坏性 migration，因此代码回滚不需要数据回滚。
