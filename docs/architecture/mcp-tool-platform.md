# MCP 工具平台架构设计

> 新的目标更简单：第一版不做复杂权限系统，只做 **方法级可见性控制**。哪个 Agent 能看到哪些 MCP 方法，就只能调用哪些 MCP 方法。

## 当前落地状态

已实现第一版主链路：

- Gateway 已挂载 `/mcp` HTTP MCP 入口，服务名 `ai-ide-tools`。
- 支持 tool context token，数据库只保存 token hash。
- `tools/list` 按 token 中的 `visibleTools` 过滤。
- `tools/call` 再次检查方法是否可见，不可见则拒绝并写审计。
- HTTP MCP 和 stdio 回退共用 `ToolRuntime`。
- 已新增 `tool_contexts`、`tool_call_audit` 两张 SQLite 表。
- 已内置 `core.project.*`、`core.agent.*`、`agent.template.*`、`core.session.*`、`core.task.*`、`team.*`、`event.*` 平台方法。
- 已内置 `core.kb.*` 知识库方法，用于 Agent 读写 LLM Wiki、挂载 shared 库、刷新 code 页面和撤销活动。
- `team.*` 只作为内置方法注册，不做全局默认绑定；需要按 Agent 显式绑定或套用 Team Profile。
- ToolContext 支持 `projectId`、`agentId`、`sessionId`，以及团队协作场景的 `teamId` / `teamMemberId`。
- 第三方 MCP 仍保持直接注入，不在第一版做方法级代理。

## 1. 设计目标

AI IDE Studio 要把平台能力稳定地提供给 Claude Code、Codex 以及未来的 Agent 使用。

目标有三个：

1. **平台功能可以很容易发布成 MCP 工具**
   - 任务、项目、会话、团队、模型、定时任务等平台功能，后续都可以包装成 MCP tool。
   - 业务模块只负责注册工具定义和 handler，不需要关心 MCP 协议细节。

2. **Agent 可以绑定到具体 MCP 方法**
   - 不是只能控制“这个 Agent 能不能用整个 MCP 服务”。
   - 而是可以控制到具体方法，比如：
     - 可以用 `team.list`
     - 不可以用 `team.create`
     - 可以用 `core.task.list`
     - 不可以用 `core.task.update`

3. **Token 控制工具可见性和调用边界**
   - 每个 Agent Session 创建一个工具上下文 token。
   - `tools/list` 只返回这个 token 可见的工具。
   - `tools/call` 再次检查调用的工具是否在 token 可见工具里。

第一版明确不做复杂的 scopes、role policy、权限树、审批流。后续如果需要，可以在可见性模型之上继续扩展。

## 2. 一句话架构

AI IDE Studio 只暴露一个长驻的 HTTP MCP Gateway，平台内每个可给 AI 调用的能力都注册成一个 MCP tool method；Agent 绑定具体 method，Session token 记录本次会话可见的 method 列表。

```text
Claude / Codex / 其他 Agent
  ↓ HTTP MCP + Bearer Token
AI IDE Studio MCP Gateway
  ↓
ToolRegistry        负责有哪些工具
VisibilityResolver  负责这个 Agent 能看哪些工具
ToolRuntime         负责真正执行工具
平台 Service/Store   负责业务逻辑和数据读写
```

## 3. 核心概念

### 3.1 MCP Gateway

平台内置的统一 MCP 入口。

```text
/mcp
```

它负责：

- MCP initialize
- `tools/list`
- `tools/call`
- 校验 token
- 根据 token 过滤工具列表
- 调用 ToolRuntime 执行工具
- 记录工具调用审计

它不应该直接写具体业务逻辑。

### 3.2 Tool Method

一个 MCP tool method 就是一个可被 AI 调用的平台动作。

例子：

```text
core.project.list
core.project.get
core.project.create
core.agent.list
core.agent.get
core.agent.create
agent.template.list
agent.template.get
agent.template.create
agent.template.update
agent.template.delete
core.model_profile.list
core.session.list
core.session.get
core.session.create
core.task.list
core.task.create
core.kb.list
core.kb.read_index
core.kb.read_page
core.kb.search
core.kb.create_page
core.kb.update_page
core.kb.refresh_from_code
team.list
team.create
team.member.list
team.member.spawn
team.member.message
team.mailbox.send
team.task.update
admin.model.list
admin.model.update
```

这里的粒度就是“方法”。如果只想允许 Agent 看团队，不允许创建团队，就只绑定：

```text
team.list
team.member.list
```

不要绑定：

```text
team.create
team.member.spawn
```

### 3.3 ToolRegistry

工具注册表，负责收集所有平台 MCP 工具定义。

它回答一个问题：

```text
平台现在有哪些 MCP 方法？
```

### 3.4 VisibilityResolver

可见性解析器，负责根据 Agent、Project、Session 计算可见工具。

它回答一个问题：

```text
这个 Agent 在这个项目/会话里能看到哪些 MCP 方法？
```

### 3.5 ToolContextToken

工具上下文 token。

它不是复杂权限系统，只是本次 Session 的工具可见性凭证。

里面至少对应这些信息：

```text
sessionId
agentId
projectId
visibleTools
expiresAt
revokedAt
```

服务端只保存 token hash，不保存明文 token。

### 3.6 ToolRuntime

工具运行时，负责统一执行工具。

它负责：

- 找到 tool definition
- 检查 tool 是否可见
- 调用 handler
- 处理异常
- 写审计记录
- 返回 MCP 格式结果

业务 handler 不应该绕过 ToolRuntime 被直接暴露给 MCP。

### 3.7 Event Center Tools

事件中心通过 `event.*` 方法暴露给 Agent，用于“发现事件 -> 订阅消费 -> 写回结果 -> 转任务”的闭环：

| 方法 | 用途 |
|------|------|
| `event.category.list` | 列出可见事件类别和 payload schema 提示 |
| `event.category.create` | 创建新的事件类别；已存在时失败 |
| `event.category.update` | 部分更新已有事件类别；未传字段保持不变 |
| `event.create` | 写入一条分类事件 |
| `event.list` | 查询事件中心事件 |
| `event.get` | 查看事件详情和消费记录 |
| `event.claim_next` | 领取当前 Agent 订阅的下一条待消费事件 |
| `event.consume` | 提交消费结果 |
| `event.convert_to_task` | 把事件转成普通任务 |
| `event.ignore` | 忽略事件 |
| `event.subscription.create` | 创建事件订阅规则；可设置 `autoStart` 和 `consumerSessionMode/consumerSessionId` |

`event.*` handler 只调用 `core/event-center`，工具上下文中的 `projectId` 和 `agentId` 是默认边界；模型可传的 `projectId` 只在没有会话项目上下文时作为兼容输入。

事件类别可以通过 schema hint 暴露可视字段和可过滤字段，例如 `x-list` / `x-filter` / `enum`。事件中心会把这些提示用于收件箱展示和订阅创建器中的字段过滤配置。

任务和定时工具也暴露统一会话策略：`core.task.create` / `studio.task.create` / `create_task` 支持 `sessionMode/sessionId`，`create_schedule` / `studio.schedule.create` / `studio.schedule.update` 会把策略写入规则 `action_config`。`existing` 复用指定会话，`new_each` 每次新建，`new_fixed` 在可持久化的规则或订阅上首次新建后固定复用。

`studio.task.assign` 是面向动态分派场景的显式任务分派工具，默认只接受未分派任务；如果需要改派，必须显式传 `allowReassign=true`。`core.timeline.list` 则把会话时间线摘要暴露给 Agent，便于订阅者基于历史过程做调度判断。

### 3.8 Knowledge Base Tools

知识库通过 `core.kb.*` 方法暴露给 Agent，读写边界来自当前 tool context 的 `projectId`。Agent 的标准检索路径是 index-first：先 `core.kb.list` 看当前项目可见库，再 `core.kb.read_index` 读索引页，必要时用 `core.kb.read_page` 或 `core.kb.search` 深入页面。

| 方法 | 用途 |
|------|------|
| `core.kb.list` | 列出当前项目可见知识库：项目库 + 已挂载 shared 库 |
| `core.kb.read_index` | 读取某个可见库的索引页 |
| `core.kb.read_page` | 按 pageId 或 kbId + title 读取页面正文、出链和反向链接 |
| `core.kb.search` | 在可见知识库内用 SQL LIKE 搜索标题、摘要和正文 |
| `core.kb.create_page` | 创建 Markdown 页面并记录 activity；孤儿页会返回 warning |
| `core.kb.update_page` | 更新页面正文/元数据，并保存旧快照 |
| `core.kb.refresh_from_code` | 对 src=code 页面写入刷新后的正文、更新指纹并清 stale |
| `core.kb.create_kb` | 创建 project 或 shared 知识库；project 库受每项目唯一约束 |
| `core.kb.mount` / `core.kb.unmount` | 将 shared 库挂载到当前项目或卸载 |
| `core.kb.revert` | 按 activity 快照撤销某次 create/edit/refresh |

工具本身不调用 LLM，也不自动从源文件生成正文。code 页面刷新由调用方先读取当前源文件并形成 markdown，再调用 `core.kb.refresh_from_code` 写入；若页面有人工编辑记录，需要显式传确认参数。

## 4. 目录结构建议

建议把 MCP 工具平台拆成几个小模块，避免继续堆大文件。

```text
src/tools/
├── definitions/                  # 平台工具定义，按业务域拆分
│   ├── core/
│   │   ├── project.tools.ts       # core.project.*
│   │   ├── task.tools.ts          # core.task.*
│   │   └── session.tools.ts       # core.session.*
│   ├── team/
│   │   ├── team.tools.ts          # team.*
│   │   └── member.tools.ts        # team.member.*
│   ├── admin/
│   │   ├── model.tools.ts         # admin.model.*
│   │   └── tool.tools.ts          # admin.tool.*
│   └── index.ts                   # 注册所有平台工具
│
├── registry/
│   ├── tool-registry.ts           # 工具注册表
│   ├── visibility-resolver.ts     # 解析 Agent/Project/Session 可见工具
│   └── context-registry.ts        # 创建、校验、撤销 token
│
├── runtime/
│   ├── tool-runtime.ts            # 统一执行入口
│   └── audit-service.ts           # 工具调用审计
│
├── mcp/
│   ├── http-mcp-server.ts         # HTTP MCP 协议适配
│   └── mcp-response.ts            # MCP 响应/错误格式
│
├── resolver.ts                    # 生成 ACP mcpServers 配置
└── types.ts                       # 工具类型定义
```

边界要求：

- `definitions/` 只定义工具和 handler。
- `mcp/` 只处理 MCP 协议，不写业务逻辑。
- `registry/` 只处理工具发现、绑定、token 上下文。
- `runtime/` 只处理执行、校验、审计。
- 平台业务逻辑继续放在对应 core/store/service 模块，工具 handler 只是调用它们。

## 5. 平台功能如何发布成 MCP

后续平台功能想发布成 MCP，不需要手写 MCP 协议，只需要注册一个工具定义。

示例：发布“创建任务”功能。

```ts
export const createTaskTool = definePlatformTool({
  name: 'core.task.create',
  displayName: '创建任务',
  description: '在当前项目中创建一个任务',
  namespace: 'core',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题' },
      description: { type: 'string', description: '任务描述' },
    },
    required: ['title'],
  },
  async handler(input, context) {
    return taskService.create({
      projectId: context.projectId,
      title: input.title,
      description: input.description,
    })
  },
})
```

注册后，工具平台会自动获得：

```text
工具列表展示
Agent 绑定能力
token 可见性控制
tools/list 输出
tools/call 执行
调用审计
```

也就是说，新增平台 MCP 方法的标准步骤是：

```text
1. 平台功能先沉到 service/store 层。
2. 在 src/tools/definitions/<domain>/ 下新增 tool definition。
3. 在 definitions/index.ts 注册。
4. 在工具管理或配置里绑定给 Agent/Project。
5. Agent 新建 Session 后即可看到该方法。
```

不应该每新增一个工具都去改 ACP Host，也不应该在 MCP Server 里写一堆业务 switch。

## 6. Agent 如何绑定 MCP 方法

Agent 绑定的是具体 tool method。

例如一个只读团队 Agent：

```text
agent: team-reader
visible tools:
  - team.list
  - team.get
  - team.member.list
  - core.task.list
```

一个团队管理 Agent：

```text
agent: team-manager
visible tools:
  - team.list
  - team.get
  - team.create
  - team.member.list
  - team.member.spawn
  - team.task.update
  - core.task.list
  - core.task.create
```

一个平台管理员 Agent：

```text
agent: platform-admin
visible tools:
  - admin.model.list
  - admin.model.update
  - admin.tool.list
  - admin.tool.bind
  - core.project.list
  - core.agent.list
```

绑定层级建议保留现有思路：

```text
global   全局默认可见
project  某个项目可见
agent    某个 Agent 可见
session  某个会话临时可见，后续需要时再加
```

解析时可以按简单规则处理：

```text
最终可见工具 = global + project + agent + session
```

同一个方法如果命中多层绑定，按更具体的层级覆盖：

```text
agent > project > global
```

`tool_bindings.enabled = 0` 表示显式隐藏，用于覆盖上层可见绑定：

```text
全局默认有 core.task.create
某个 Agent 设置 core.task.create enabled = 0
最终这个 Agent 看不到 core.task.create
```

第一版不需要做复杂的权限表达式。

### 6.1 Team Profile

Team Profile 是一组预设的 `team.*` 方法绑定，不是角色权限系统。

```text
team-readonly  只读观察：team.list / team.get / team.member.list / team.task.list / team.mailbox.list
team-member    协作成员：只读 + team.mailbox.send / team.task.update
team-leader    编排者：协作 + team.create / team.update / team.member.spawn / team.member.message / team.task.create / team.template.*
```

套用 Profile 时，平台写入 Agent 级绑定：

- Profile 内 `team.*` 方法启用。
- Profile 外 `team.*` 方法禁用，用来隐藏上层 project/global 绑定。
- 非 Team 方法不变。

前端“工具管理”页提供 Agent 选择、Profile 套用和单个 `team.*` 方法开关。

## 7. Token 如何控制工具可见性

创建 Agent Session 时，后端做这几步：

```text
1. 根据 agentId/projectId 查工具绑定。
2. 解析出 visibleTools。
3. 创建 tool context token。
4. 把 token 注入 ACP Session 的 mcpServers 配置。
```

注入给 Claude/Codex 的配置类似：

```ts
{
  type: 'http',
  name: 'ai-ide-tools',
  url: 'http://127.0.0.1:18800/mcp',
  headers: [
    { name: 'Authorization', value: 'Bearer <token>' }
  ]
}
```

### 7.1 tools/list

```text
Agent 请求 tools/list
  ↓
MCP Gateway 校验 token
  ↓
找到 token 对应的 visibleTools
  ↓
只返回 visibleTools 里的工具定义
```

Agent 看不到的工具，不会出现在工具列表里。

### 7.2 tools/call

```text
Agent 请求 tools/call: core.task.create
  ↓
MCP Gateway 校验 token
  ↓
检查 core.task.create 是否在 visibleTools 里
  ↓
不在：拒绝
在：交给 ToolRuntime 执行
```

注意：**必须在 tools/call 再检查一次**。

不能只靠 `tools/list`。因为客户端理论上可以手动构造一个工具调用。

## 8. MCP 请求流程

### 8.1 新建会话流程

```text
用户创建/打开 Agent Session
  ↓
后端确定 agentId、projectId、sessionId
  ↓
VisibilityResolver 解析这个 Agent 可见的工具方法
  ↓
ContextRegistry 创建 token，并保存 token hash + visibleTools
  ↓
ACP Host 创建 Claude/Codex Session，并注入 ai-ide-tools HTTP MCP
  ↓
Agent 通过 /mcp 发现和调用工具
```

### 8.2 工具调用流程

```text
Agent tools/call
  ↓
HTTP MCP Server
  ↓
ContextRegistry 校验 token
  ↓
ToolRuntime 检查 toolName 是否可见
  ↓
ToolRegistry 获取 tool definition
  ↓
调用 tool.handler(input, context)
  ↓
AuditService 记录结果
  ↓
返回 MCP result
```

## 9. 数据模型建议

### 9.1 tools

每一行代表一个 MCP tool method。

```sql
CREATE TABLE tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  namespace TEXT NOT NULL,
  source TEXT NOT NULL,              -- platform / external / custom
  description TEXT NOT NULL,
  input_schema_json TEXT,
  output_schema_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

说明：

```text
name = core.task.create 这种方法名
namespace = core / team / admin / external / custom
source = platform / external / custom
```

### 9.2 tool_bindings

控制某个方法对谁可见。

```sql
CREATE TABLE tool_bindings (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  scope TEXT NOT NULL,               -- global / project / agent / session
  target_id TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  config_override_json TEXT,
  created_at TEXT NOT NULL
);
```

说明：

```text
scope=global, target_id=null      全局默认
scope=project, target_id=项目 ID   某项目可见/隐藏
scope=agent, target_id=Agent ID    某 Agent 可见/隐藏
scope=session, target_id=会话 ID   某会话临时可见/隐藏
```

第一版可以先用现有 `enabled` 表达可见；如果要支持“隐藏上层绑定”，再加 `visible` 更清晰。

### 9.3 tool_contexts

保存 Session token 对应的工具上下文。

```sql
CREATE TABLE tool_contexts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  acp_session_id TEXT,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  team_id TEXT,
  team_member_id TEXT,
  visible_tools_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
```

说明：

- 原始 token 只在创建时返回。
- 数据库只存 token hash。
- `visible_tools_json` 是本次会话能看到的方法名列表。
- `team_id` / `team_member_id` 用于 Team 成员会话的默认工具上下文；没有团队上下文时为空。
- Session 关闭时撤销 token。

### 9.4 tool_call_audit

记录工具调用。

```sql
CREATE TABLE tool_call_audit (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL,              -- succeeded / failed / denied / timeout
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT
);
```

即使第一版不做审批，也建议保留审计。因为它能解决两个实际问题：

1. 前端可以展示 Agent 调用了什么工具。
2. 刷新或切换会话回来后，历史工具调用还能看到。

## 10. 第三方 MCP 的处理原则

第三方 MCP 第一版不用做太细。

建议原则是：

1. **短期可以继续整体注入第三方 MCP**
   - 例如浏览器 MCP、文件系统 MCP、GitHub MCP。
   - 平台只能控制“这个 Agent 能不能用这个 MCP 服务”。

2. **如果要控制到第三方 MCP 的某个方法，就需要平台代理**
   - 例如想只允许 GitHub 的 `list_issues`，不允许 `delete_repo`。
   - 这种情况下要把外部方法代理成平台工具：

```text
external.github.list_issues
external.github.create_issue
external.github.delete_repo
```

然后仍然走同一套可见性模型。

3. **不要把第三方 MCP 细粒度代理作为第一阶段重点**
   - 第一阶段先把平台自己的 MCP 方法跑通。
   - 第三方 MCP 先保留兼容入口。

## 11. 分阶段落地建议

### 阶段 1：统一工具定义和运行时

目标：平台工具都通过 ToolRegistry 和 ToolRuntime 执行。

做完后应该能做到：

```text
定义一个 core.task.list 工具
ToolRegistry 能列出来
ToolRuntime 能执行它
```

### 阶段 2：实现可见性绑定

目标：Agent 可以绑定具体 tool method。

做完后应该能做到：

```text
Agent A 能看到 core.task.list
Agent A 看不到 core.task.create
Agent B 两个都能看到
```

### 阶段 3：实现 tool context token

目标：每个 Session 都有自己的 token 和 visibleTools。

做完后应该能做到：

```text
token A 的 tools/list 返回 A 的工具
token B 的 tools/list 返回 B 的工具
手动调用不可见工具会被拒绝
```

### 阶段 4：实现 HTTP MCP Gateway

目标：Claude/Codex 通过 HTTP MCP 使用平台工具。

做完后应该能做到：

```text
ACP Session 注入 ai-ide-tools HTTP MCP
Agent 能看到绑定的方法
Agent 能调用允许的方法
Agent 调用不可见方法会失败
```

### 阶段 5：补第一批平台工具

建议先做少量代表性工具，不要一口气全做。

第一批推荐：

```text
core.project.list
core.project.get
core.project.create
core.agent.list
core.agent.get
core.agent.create
core.model_profile.list
core.session.list
core.session.get
core.session.create
core.task.list
core.task.create
team.list
team.member.list
```

这些工具能验证：

- 平台功能发布 MCP
- 只读工具
- 写入工具
- Agent 方法级绑定
- token 可见性控制

### 阶段 6：审计展示

目标：前端会话里能看到 MCP 工具调用，并且刷新后还能恢复。

做完后应该能做到：

```text
Agent 调用了 core.task.create
前端时间线显示工具调用
刷新页面后仍能看到这次调用
```

## 12. 设计边界

第一版做：

```text
一个 HTTP MCP Gateway
平台功能注册为 MCP tool method
Agent/Project 绑定具体 method
Session token 保存 visibleTools
tools/list 按 token 过滤
tools/call 按 token 再检查
简单工具调用审计
```

第一版不做：

```text
复杂 scope 权限
task:read / task:create 这类权限表达式
角色权限系统
审批流
第三方 MCP 方法级代理
复杂策略优先级
```

后续如果需要扩展权限，不需要推倒重来。可以在现有模型上增加：

```text
requiredScopes
role policies
approval rules
external MCP proxy
```

但当前最重要的是先把“平台功能发布 MCP + Agent 方法级可见性 + token 强制边界”跑通。


## Tool Context Boundary

MCP tool schemas expose business inputs only. System-owned scope and identity fields are injected by the platform through the tool context token and `ToolContext`, not by the model.

System-owned fields include `projectId`, `teamId`, `teamMemberId`, `fromMemberId`, `leaderAgentId`, and `sessionId`. When the current session already has project or team context, `tools/list` hides those fields from the model-visible input schema. `tools/call` still validates execution with the same context, so manually submitted scope or identity fields cannot move a call into another project, Team, member, or session.

Business target fields such as `memberId`, `taskId`, `templateId`, and target `agentId` may remain visible when the model must choose a target, but handlers must validate that the target belongs to the current project or Team.
