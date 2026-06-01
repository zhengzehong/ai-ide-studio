# AionUi Team / Multi-Agent 源码分析报告

## 0. 获取源码状态

用户要求放在参考项目目录下，目录已按后续可扩展方式整理为：

```text
references/
└── projects/
    ├── AionUi/          # 早期摘录/笔记
    └── AionUi-source/   # 本次源码快照与源码笔记
```

我尝试执行完整 `git clone --depth 1 https://github.com/iOfficeAI/AionUi`，但当前沙箱里 Git 创建 worktree / `.git` 会报 `Permission denied`。因此本次用 GitHub API / raw URL 拉取了源码树与关键源码文件，放在：

- `references/projects/AionUi-source/AIONUI_SOURCE_INFO.json`
- `references/projects/AionUi-source/SOURCE-NOTES.md`
- `references/projects/AionUi-source/packages/desktop/src/common/types/team/teamTypes.ts`（此前已落盘）

已确认 upstream：

- 仓库：`https://github.com/iOfficeAI/AionUi`
- 默认分支：`main`
- GitHub tree：1975 个 path，`truncated=false`
- 最近 pushed_at：`2026-05-29T02:06:09Z`

> 结论：不是完整 Git checkout，但分析基于源码文件内容，不是只看 README。后续如果本机权限恢复，建议再补一次真实 clone 到 `references/projects/AionUi-full/`。

---

## 1. AionUi Team Mode 是什么

AionUi 的 Team Mode 是“一个 Leader + 多个 Teammate”的协作模型：

```text
用户
  ↓
Leader Agent
  ↓ 通过 Team MCP Server 调用 team_* 工具
Team Runtime / Backend
  ├─ spawn / remove / rename teammate
  ├─ 写 teams / mailbox / team_tasks
  ├─ 为每个 teammate 管理独立 conversation/session
  └─ 通过 WS 推送状态和消息
       ↓
前端 TeamPage：多个 Agent tab / 多列 chat slot
```

README 中明确描述：Leader 接收用户指令、拆分子任务，通过内置 Team MCP Server 委派给 Teammates；Teammates 并行执行，共享工作目录，通过 async mailbox 交换结果，并写 shared task board。

关键点：

- Leader 和每个 Teammate 都是独立 conversation/session。
- 所有成员共享 workspace folder。
- 每个成员有独立权限确认弹窗。
- Leader 通过 MCP 工具动态添加/移除成员。
- UI 上每个成员是一个 tab / chat slot，可直接切过去看该成员会话。

---

## 2. 源码里的核心数据模型

源码：`packages/desktop/src/common/types/team/teamTypes.ts`

### TeamAgent

```ts
export type TeamAgent = {
  slot_id: string
  conversation_id: string
  role: 'leader' | 'teammate'
  agent_type: string
  icon?: string
  agent_name: string
  conversation_type: string
  status: 'pending' | 'idle' | 'active' | 'completed' | 'failed'
  cli_path?: string
  custom_agent_id?: string
  model?: string
}
```

### TTeam

```ts
export type TTeam = {
  id: string
  user_id: string
  name: string
  workspace: string
  workspace_mode: 'shared' | 'isolated'
  leader_agent_id: string
  agents: TeamAgent[]
  session_mode?: string
  created_at: number
  updated_at: number
}
```

AionUi 把 `agents` 存成 JSON 数组，这样实现快，但后续要按成员查询/统计/权限过滤会比较麻烦。

---

## 3. SQLite 表设计

源码：

- `packages/desktop/src/process/services/database/schema.ts`
- `packages/desktop/src/process/services/database/migrations.ts`

AionUi Team 相关表：

```sql
teams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  workspace TEXT NOT NULL,
  workspace_mode TEXT NOT NULL DEFAULT 'shared',
  lead_agent_id TEXT NOT NULL DEFAULT '',
  agents TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

mailbox (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  to_agent_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  summary TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)

team_tasks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  owner TEXT,
  blocked_by TEXT NOT NULL DEFAULT '[]',
  blocks TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

迁移顺序上，v19 创建 `teams`，v20 再补 `lead_agent_id`、`mailbox`、`team_tasks`。源码注释还专门说明 v19 漏了 `lead_agent_id`，v20 用 `ALTER TABLE` 兼容。

### 对我们的启发

我们已经有 `projects / agents / sessions / messages / tasks / session_events`。所以不应该照搬 AionUi 的 `agents TEXT JSON`，更适合：

```text
teams
team_members
team_mailbox
team_tasks 或直接复用 tasks + team_id
team_events
```

原因：

- 我们 Agent/Session 已经是一等实体，Team member 应该引用它们。
- 后面要做成员状态、权限、工具可见性、查询统计，规范化表比 JSON 更稳。
- 我们现有任务表已经项目级，可扩展 `team_id`，不一定另起 `team_tasks`。

---

## 4. AionUi 的 API / IPC / WS 面

源码：`packages/desktop/src/common/adapter/ipcBridge.ts`

AionUi 前端调用的是 HTTP API + WS emitter。Team 方法：

| 方法 | HTTP |
|---|---|
| `team.create` | `POST /api/teams` |
| `team.list` | `GET /api/teams?user_id=...` |
| `team.get` | `GET /api/teams/:id` |
| `team.remove` | `DELETE /api/teams/:id` |
| `team.addAgent` | `POST /api/teams/:team_id/agents` |
| `team.removeAgent` | `DELETE /api/teams/:team_id/agents/:slot_id` |
| `team.stop` | `DELETE /api/teams/:team_id/session` |
| `team.ensureSession` | `POST /api/teams/:team_id/session` |
| `team.renameAgent` | `PATCH /api/teams/:team_id/agents/:slot_id/name` |
| `team.renameTeam` | `PATCH /api/teams/:id/name` |
| `team.setSessionMode` | `POST /api/teams/:team_id/session-mode` |

WS 事件：

- `team.agent.status`
- `team.agent.spawned`
- `team.agent.removed`
- `team.agent.renamed`
- `team.list-changed`
- `team.created`
- `team.teammate.message`

### 对我们的启发

我们的通信是 WS RPC，不是 Electron IPC + HTTP bridge。建议保留我们的风格：

```text
teams.list/create/get/update/delete
teams.members.add/remove/rename/list
teams.ensureSessions
teams.setMode
teams.mailbox.list/send
teams.tasks.list/create/update
```

事件：

```text
team:changed
team:member.status
team:member.spawned
team:member.removed
team:mailbox.message
team:task.updated
```

不要新开一个 HTTP Team API，避免双协议分裂。

---

## 5. Team MCP 是怎么通信的

源码证据主要来自：`tests/e2e/specs/team-describe-assistant.e2e.ts`

这个 E2E 注释很关键，说明 Team MCP 的真实链路：

1. MCP tool 注册在 `teamMcpStdio.ts`。
2. 实际 dispatch 在 `TeamMcpServer.ts`。
3. `team.create` + `team.ensureSession` 后，Leader conversation 的 `extra.teamMcpStdioConfig.env` 会出现：
   - `TEAM_MCP_PORT`
   - `TEAM_MCP_TOKEN`
4. 测试直接打开 TCP socket，按 4-byte length-prefixed JSON frame 协议请求 Team MCP。
5. 请求结构：

```ts
{
  tool: 'team_describe_assistant',
  args: { custom_agent_id: candidate, locale: 'en-US' },
  auth_token: token,
  from_slot_id: leader.slot_id,
}
```

以及：

```ts
{
  tool: 'team_spawn_agent',
  args: { name: teammateName, custom_agent_id: presetId },
  auth_token: token,
  from_slot_id: leader.slot_id,
}
```

测试还验证了：

- 错误 token 返回 `Unauthorized`
- `team_describe_assistant` 返回 assistant 描述、skills、example tasks，以及提示可以用 `team_spawn_agent`
- `team_spawn_agent` 能基于 preset 创建 teammate

### 重点理解

AionUi 不是让 Leader 直接操作数据库，而是给 Leader 注入一个 Team MCP Server。Leader 通过工具调用完成团队编排：

```text
Leader Agent prompt
  ↓
Agent decides to call tool team_spawn_agent
  ↓
Team MCP stdio bridge
  ↓ TCP frame + token
TeamMcpServer
  ↓
Team backend creates teammate + conversation/session
  ↓
WS emits team.agent.spawned / status
  ↓
UI refreshes team tabs
```

这是 Team 模式的关键：**多 Agent 的“协作动作”也应该是工具，而不是写死在 UI 里。**

---

## 6. 前端 Team UI 是怎么组织的

关键源码：

- `TeamCreateModal.tsx`
- `TeamPage.tsx`
- `TeamChatView.tsx`
- `TeamTabs.tsx`
- `TeamTabsContext.tsx`
- `useTeamSession.ts`
- `useTeamPendingPermissions.ts`
- `useSiderTeamBadges.ts`
- `TeamPermissionContext.tsx`

### 创建团队

`TeamCreateModal` 做了几件事：

1. 读取 CLI agents + preset assistants。
2. 只允许 `team_capable` 的 agent 被选为 Leader。
3. 根据 backend 推断 conversation type。
4. 解析默认模型。
5. 组一个初始 `agents` 数组，里面只有 Leader：

```ts
{
  slot_id: '',
  conversation_id: '',
  role: 'leader',
  status: 'pending',
  agent_type: dispatchAgentType,
  agent_name: 'Leader',
  conversation_type: dispatchConversationType,
  custom_agent_id: dispatchAgent?.id,
  model: resolvedModel,
}
```

后端负责补 slot / conversation。

### 展示团队

`TeamPage` 的核心是：每个 `TeamAgent` 都对应一个 `conversation_id`，然后渲染一个 `AgentChatSlot`。

`TeamChatView` 不重新造聊天组件，而是按 conversation type 复用已有 chat：

- `acp` → `AcpChat`
- legacy `codex` → `AcpChat` + backend=codex
- `aionrs` → `AionrsChat`
- `openclaw-gateway` → `OpenClawChat`
- `nanobot` → `NanobotChat`
- `remote` → `RemoteChat`

这点非常值得我们参考：Team 不是一套新聊天协议，而是“组织多个现有 session”。

### 状态同步

`useTeamSession` 订阅：

- `team.agent.status` → 更新 statusMap
- `team.agent.spawned` → mutate team
- `team.agent.removed` → mutate team
- `team.agent.renamed` → mutate team

### 权限角标

`useTeamPendingPermissions` / `useSiderTeamBadges` 按 `conversation_id` 拉取 confirmation 数量，并订阅 confirmation add/remove 事件，最后映射到 Team tab / sidebar badge。

### Team Permission Context

`TeamPermissionContext` 提供：

- `leaderConversationId`
- `allConversationIds`
- `propagateMode(mode)`：保存 team 的 `session_mode`
- `warmupSession()`：调用 `team.ensureSession`

ACP Chat 在 Team 模式里会 `skipWarmup`，改为先让 team ensure sessions，避免切换多个 tab 时每个会话乱预热。

---

## 7. AionUi 设计优点和问题

### 优点

1. **Leader 编排通过 MCP 工具实现**
   - Agent 自己决定何时 spawn / message / assign。
   - UI 不需要写死“分配任务”的业务流程。

2. **成员复用现有 conversation/chat 组件**
   - Team 是组织层，不是新聊天层。
   - 单 Agent 能力和 Team 成员能力天然一致。

3. **每个成员独立会话上下文**
   - 并行执行不会互相污染上下文。
   - 切 tab 可看到成员自己的流式过程和工具调用。

4. **共享 workspace**
   - 多 Agent 协作改同一个项目目录，符合 IDE 场景。

5. **权限提示按成员聚合**
   - 多 Agent 并行时，哪个成员卡在权限请求上一眼能看到。

### 问题 / 不适合照搬处

1. **teams.agents 用 JSON 存储**
   - 快，但不利于查询、迁移、权限、状态统计。
   - 我们已经有 `agents`、`sessions` 表，照搬会重复建模。

2. **Team MCP 用额外 TCP bridge**
   - 对 AionUi 可能合理，但我们已经有 HTTP MCP Gateway + token 可见性。
   - 再加 TCP TeamMcpServer 会多一条运维/调试链路。

3. **API 风格不同**
   - AionUi 是 Electron bridge + HTTP API。
   - 我们是 WS RPC + SQLite store + core service。

4. **Team 后端源码在当前 tree 中路径不直观**
   - E2E 提到了 `teamMcpStdio.ts` / `TeamMcpServer.ts`，但 GitHub tree 里未直接出现这些路径名，可能来自打包后端或外部包。
   - 所以本报告对 Team MCP 后端实现细节以 E2E 注释和行为验证为准。

---

## 8. 我们应该怎么做

### 总体建议

我们应该做“AI IDE Studio 原生 Team 域”，不是复制 AionUi 的 TCP Team MCP。

核心原则：

```text
Team = Project 下的一组 Agent 实例 + Session 实例
Leader = 拥有 team.* MCP 工具的普通 Agent
Teammate = 普通 Agent，只是归属于 Team
协作动作 = MCP tool call
UI = 复用现有 ChatView / SessionTimeline / 工具调用展示
```

### 推荐架构

```text
src/core/teams.ts              # Team 业务服务：创建团队、成员、会话、状态、mailbox
src/store/teams.ts             # SQLite CRUD
src/store/migrations/005-teams.ts
src/gateway/rpc/teams.ts       # WS RPC
src/tools/handlers/team/*.ts   # team.* MCP 工具
ui/src/stores/team.store.ts
ui/src/pages/TeamWorkspace.tsx 或在 Workspace 加 Team tab
ui/src/components/team/*
```

数据库建议：

```sql
teams (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  leader_agent_id TEXT NOT NULL,
  leader_session_id TEXT,
  workspace_mode TEXT NOT NULL DEFAULT 'shared',
  session_mode TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  role TEXT NOT NULL, -- leader / teammate
  name TEXT NOT NULL,
  status TEXT NOT NULL, -- pending / idle / active / failed / removed
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

team_mailbox (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  from_member_id TEXT NOT NULL,
  to_member_id TEXT,
  type TEXT NOT NULL DEFAULT 'message',
  content TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
)

-- 可选：如果不复用现有 tasks，再单独建 team_tasks。
-- 更推荐第一版先给 tasks 加 team_id。
```

### Team MCP 工具建议

第一版只给 Leader 注入：

```text
team.member.list
team.member.spawn
team.member.message
team.member.remove
team.task.create
team.task.update
team.mailbox.list
team.mailbox.send
```

其中：

- `team.member.spawn`：基于 templateId / runtime / name 创建 Agent + Session + team_member。
- `team.member.message`：向某个成员 session 发 prompt。
- `team.task.create`：创建平台 task，带 teamId / assignee。
- `team.mailbox.send`：轻量留言，不一定立即触发 prompt。

第二版再给 Teammate 注入：

```text
team.mailbox.list
team.mailbox.send
team.task.list
team.task.update
```

这样 Teammate 可以汇报状态、更新任务，但不能随便 spawn 新人。

### 和现有 MCP Gateway 的结合

我们已有 `mcp-tool-platform.md` 里的工具可见性/token 模型：

- Session 创建时生成 tool context token。
- token 里有 `visibleTools`。
- `tools/list` 只返回可见工具。
- `tools/call` 再次检查可见性。

Team 不需要新建 TCP Server。做法是：

```text
Leader session 创建
  → resolveMcpServersForAcp
  → 发现该 session 属于 team leader
  → visibleTools 追加 team.* leader tools
  → 注入现有 /mcp HTTP MCP Gateway
```

对 Claude / Codex 来说，它看到的就是普通 MCP tools。

---

## 9. 建议实现顺序

### P0：Team 数据域 + UI 能创建/查看

目标：不是自动协作，先把 Team 作为一等实体跑通。

- 新增迁移 `005-teams.ts`
- 新增 `teamStore`
- 新增 `teamManager`
- 新增 WS RPC：
  - `teams.list`
  - `teams.create`
  - `teams.get`
  - `teams.delete`
  - `teams.members.list`
- 创建 Team 时：
  - 必须选 project
  - 必须选 leader agent 或模板
  - 创建 leader session
  - 写 team + team_member

### P1：Leader Team MCP 工具

目标：Leader 能通过工具添加成员、发消息、创建团队任务。

- 新增 `src/tools/handlers/team/`
- seed 工具：
  - `team.member.list`
  - `team.member.spawn`
  - `team.member.message`
  - `team.task.create`
- Tool handler 调用 `teamManager`
- Leader session 的 tool visibility 自动包含 leader tools

### P2：Team Workspace 前端

目标：像 AionUi 一样，Team 页面能看到成员 tab、状态、会话内容。

- Team 列表 / 创建弹窗
- Team member tabs
- 每个 tab 复用现有 ChatView / SessionTimeline
- 成员状态 badge
- pending permission 计数聚合

### P3：Mailbox / Task Board / 状态同步

目标：让协作过程可追踪。

- `team_mailbox`
- `team.mailbox.*` tools
- task 增加 `team_id` / `assignee_member_id`
- WS 事件持久化到 `team_events`
- 刷新/切换后仍能恢复团队状态和消息流

### P4：高级能力

- session mode 从 leader 同步到成员
- 批量 ensure sessions / warmup
- 成员失败检测 / 一键移除
- 文件附件从 Leader 转发给 Teammate
- 成员模型切换与默认模型解析

---

## 10. 对当前项目的风险点

1. **会话恢复与 Team 状态必须落库**
   - AionUi 通过 conversation_id + team.agents 恢复。
   - 我们必须通过 `team_members.session_id` + `sessions.acp_session_id` 恢复。

2. **工具调用展示要复用 session_events**
   - 用户之前要求刷新/切换会话回来还能看到工具调用。
   - Team 成员会话也必须走同一套 `session_events`，不要单独写临时状态。

3. **Team 工具不能绕过项目作用域**
   - `team.member.spawn` 必须继承 `team.project_id`。
   - 创建的 Agent / Session / Task 都必须写同一个 projectId。

4. **不要做新的 TCP MCP 层**
   - 我们已有 HTTP MCP Gateway；新 TCP 层只会增加复杂度。

5. **Agent 模板 vs Agent 实例要分清**
   - Team spawn 最好支持 `templateId`，创建项目级 Agent 实例。
   - 不要让 Team member 直接引用全局模板当运行时实体。

---

## 11. 最终结论

AionUi 的 Team Mode 最值得借鉴的是三件事：

1. **Leader 通过 MCP 工具编排团队**，不是 UI 写死流程。
2. **每个成员都是独立 session**，UI 只是在 Team 容器里组织多个普通 chat。
3. **状态/权限/消息都按成员聚合显示**，并且可通过持久化 conversation/session 恢复。

我们不建议照搬的是：

- `teams.agents` JSON 存储
- 单独 TCP Team MCP Server
- Electron HTTP bridge API 形态

AI IDE Studio 更合理的落地方式是：

```text
规范化 Team 数据表
+ WS RPC Team 域
+ 现有 Session/Agent/Task 复用
+ 现有 HTTP MCP Gateway 注入 team.* 工具
+ 前端 Team 页面复用现有对话/事件展示组件
```

这样后续新增 Agent 框架、更多 MCP 方法、项目级权限、团队任务板，都会比较自然，不会和现有架构打架。
