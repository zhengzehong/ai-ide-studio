# 本地会话导入设计

## 目标

在项目对应的 Agent 列表中增加“导入本地会话”入口，允许用户把本机 Codex 或 Claude Code 的原始 JSONL 会话绑定到平台会话上，并从平台继续对话。

本设计采用方案 B：只导入会话连接关系，不解析历史消息。

## 范围

本次能力包含：

- 在项目 Agent 列表的 Agent 行右键菜单中增加“导入本地会话”。
- 支持用户输入原始 `.jsonl` 文件路径导入。
- 支持用户从扫描到的本地会话列表中选择导入。
- 创建一条新的平台 `sessions` 记录，并写入外部 ACP 会话 id。
- 导入后选中新建的平台会话，用户可以继续发送消息。

本次不包含：

- 不解析历史消息内容。
- 不复制历史 `messages`、`session_events`、`turn_process_items`。
- 不把 Codex / Claude Code 历史对话渲染到平台聊天区。
- 不做非破坏性的 fork 复制。
- 不跨机器、跨账号、跨 HOME 目录迁移会话文件。

## 用户体验

用户在工作区选择某个项目后，可以在该项目的 Agent 列表中右键某个 Agent，菜单中出现“导入本地会话”。

点击后弹出导入弹窗，提供两种导入方式：

1. 输入 JSONL 文件路径。
2. 从本地会话列表中选择。

导入成功后，平台创建一个新的空会话并自动选中。聊天区不会显示历史消息，只显示后续在平台内产生的新消息。

新会话标题建议使用：

```text
导入本地会话 <short-session-id>
```

如果能从本地会话元数据中读取到更好的摘要或文件名，也可以作为辅助展示信息，但不作为本次核心目标。

## 数据模型

平台现有 `sessions` 表已经有 `acp_session_id` 字段。本设计复用该字段保存外部会话 id。

导入时只新增 `sessions` 记录：

- `agent_id`：右键菜单对应的 Agent。
- `project_id`：当前工作区项目。
- `acp_session_id`：从 Codex / Claude Code JSONL 中解析出的原始会话 id。
- `task_id`：默认为空，除非后续明确需要绑定任务。

不新增历史消息相关记录。

## Codex 会话识别

Codex 本地会话通常位于：

```text
C:\Users\<user>\.codex\sessions\YYYY\MM\DD\rollout-*.jsonl
```

Codex JSONL 第一行通常是 `session_meta`，其中：

```json
{
  "type": "session_meta",
  "payload": {
    "id": "019..."
  }
}
```

导入时读取 `payload.id`，作为平台 `sessions.acp_session_id`。

后续继续对话时，Codex ACP 适配器使用该 id resume 原来的 Codex thread。

## Claude Code 会话识别

Claude Code 本地会话通常位于：

```text
C:\Users\<user>\.claude\projects\<encoded-cwd>\<uuid>.jsonl
```

Claude Code JSONL 行内通常包含 `sessionId`。导入时优先读取 JSONL 中的 `sessionId`，必要时可以用文件名 UUID 作为兜底。

导入得到的 `sessionId` 写入平台 `sessions.acp_session_id`。

后续继续对话时，Claude ACP 适配器使用该 id resume 原来的 Claude Code session。

## 后端接口

新增一个会话导入 RPC，建议命名：

```text
sessions.importLocal
```

输入字段：

- `agentId`：目标 Agent。
- `projectId`：当前项目。
- `jsonlPath`：用户输入的 JSONL 文件路径，可选。
- `externalSessionId`：从本地列表选择时传入，可选。
- `sourcePath`：从本地列表选择时保留原始文件路径，可选。

后端处理流程：

1. 读取 Agent，确认 runtime 是 `codex` 或 `claude`。
2. 如果传入 `jsonlPath`，只读取文件前几行解析元数据，避免加载大文件。
3. 校验解析出的会话类型与 Agent runtime 匹配。
4. 如果 JSONL 中的 cwd 与当前项目路径不一致，返回 warning，由前端让用户确认。
5. 创建平台 session，写入 `acp_session_id`。
6. 返回新 session。

本地会话列表建议新增独立 RPC：

```text
sessions.listLocalImportCandidates
```

输入字段：

- `agentId`
- `projectId`

返回字段：

- `runtime`
- `sessionId`
- `path`
- `cwd`
- `updatedAt`
- `label`

扫描策略：

- Codex：扫描 `~/.codex/sessions/**/*.jsonl`，解析第一行 `session_meta`。
- Claude Code：优先扫描当前项目编码路径对应的 `~/.claude/projects/<encoded-cwd>/*.jsonl`，必要时再扩展到其它项目目录。
- 返回数量限制，默认取最近更新的若干条，避免 UI 卡顿。

## 前端改动

主要入口在 `Workspace` 的项目 Agent 列表。

改动点：

- 给 Agent 行增加 `onContextMenu`。
- 新增 Agent 级右键菜单状态，避免复用会话右键菜单时混淆。
- 菜单项增加“导入本地会话”。
- 新增导入弹窗组件或局部弹窗状态。
- 导入成功后，把后端返回的新 session 写入前端 session store，并选中该 session。

弹窗状态至少包含：

- `jsonlPath`
- `candidates`
- `loading`
- `importing`
- `warning`
- `error`

交互要求：

- 点击导入后显示导入中状态，避免用户不知道是否生效。
- runtime 不匹配时直接报错，不创建会话。
- cwd 不匹配时提示用户确认。

## 风险与约束

方案 B 是“续接原始本地会话”，不是 fork。后续在平台里继续发送消息时，可能会追加到原 Codex / Claude Code 本地会话中。

如果用户希望平台对话不影响原始本地会话，需要后续增加 fork 模式。

导入成功不等于 resume 一定成功。以下情况可能导致后续继续对话失败：

- 当前机器找不到原始会话文件或运行时无法访问对应 HOME 目录。
- 当前 Agent runtime 与原始会话 runtime 不一致。
- 原始会话来自不同账号、不同配置或不同工作目录。
- Codex / Claude Code ACP 适配器版本的 resume 行为变化。

## 验收标准

- 可以在项目 Agent 行右键看到“导入本地会话”。
- 可以输入 Codex JSONL 路径导入，生成平台 session，`acp_session_id` 等于 Codex `payload.id`。
- 可以输入 Claude Code JSONL 路径导入，生成平台 session，`acp_session_id` 等于 Claude `sessionId`。
- 可以从本地候选列表选择会话导入。
- 导入不会新增历史 `messages`、`session_events`、`turn_process_items`。
- 导入后前端自动选中新 session。
- runtime 不匹配时不会创建 session。
- cwd 不匹配时有明确提示或确认流程。

## 测试计划

后端测试：

- Codex JSONL 元数据解析单元测试。
- Claude Code JSONL 元数据解析单元测试。
- runtime 不匹配测试。
- `sessions.importLocal` 集成测试，验证只创建 session，不创建历史消息。
- `sessions.listLocalImportCandidates` 测试，验证返回数量限制和 runtime 过滤。

前端测试：

- Agent 右键菜单出现导入入口。
- 输入路径导入时显示 loading，并在成功后选中新会话。
- 候选列表选择导入时调用正确 RPC。
- 错误和 warning 正常展示。

手工验证：

- 使用真实 Codex JSONL 导入并继续发送一条消息。
- 使用真实 Claude Code JSONL 导入并继续发送一条消息。
- 分别验证 Codex Agent 和 Claude Agent 的 runtime 匹配约束。
