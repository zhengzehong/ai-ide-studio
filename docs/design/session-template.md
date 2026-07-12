# 会话模板(Session Template)设计方案

> 日期:2026-07-12
> 状态:方案待评审
> 范围:PC + 移动端 + AI 工具

## 一、目标

用户能把某个会话发布为"模板",下次新建会话时可以选模板,新会话从模板的完整对话上下文起步,继续对话。

**核心语义**:模板 = 一个"会话镜像",通过 ACP `forkSession` 把源会话的 transcript 完整复制成新会话。不是数据库快照,不是 system_prompt 重放——是**运行时层面的真实 fork**。

## 二、关键事实(已验证)

### 2.1 Claude Code 的 fork

- SDK:`@anthropic-ai/claude-agent-sdk` 的 `forkSession(sessionId, options)`(`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:664`)
- SDK 注释原文:
  > Fork a session into a new branch with fresh UUIDs. **Copies transcript messages from the source session into a new session file**, remapping every message UUID and preserving the parentUuid chain. Forked sessions start without undo history (file-history snapshots are not copied).
- ACP 层实现(`node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:357`):
  ```js
  async unstable_forkSession(params) {
    return this.createSession({ cwd, mcpServers, _meta }, {
      resume: params.sessionId,    // 源 sessionId
      forkSession: true,            // 强制 fork 模式
    })
  }
  ```
- 底层调 `query({ resume: sourceSessionId, forkSession: true })`,把源 transcript 的消息复制到新文件
- **Spike(task-dee3642e)实测修正 1**:SDK 注释说"remapping every message UUID",但实测 **message UUID 并未 remap**——B 的前 10 条 msg UUID 与 A 完全一致,只改了 `sessionId` 字段。对模板功能无影响,但若未来做"基于 messageId 回溯源会话"要小心
- **Spike(task-dee3642e)实测修正 2**:文档原写"不需要源 ACP 连接活着",在当前 AI Studio 代码下不成立。`src/acp/host.ts:563 forkSession` 走 `conn.acpSessions.get(sourceSessionId)` 内存 Map,Agent 重启后 Map 清空,直接 fork 报错 "Session X 没有对应的 ACP session"。源 transcript jsonl 文件还在,但 AI Studio 这层找不到 acpSessionId 入口
- **已有的解决路径**:
  - 路径 A(已用):`forkSessionFromAcpSessionId`(`src/acp/host.ts:576`)直接传 DB 里的 `acp_session_id`,内部 `startAgent` 后调 `unstable_forkSession({ sessionId: sourceAcpSessionId })`。`copySession`(`src/core/sessions.ts:244`)走这条
  - 路径 B(PR1 新增):`forkSession` 加 DB fallback——`conn.acpSessions.get(sourceSessionId) ?? sessionStore.get(sourceSessionId)?.acp_session_id`。模板 instantiate 路径走这条,Agent 重启后也能工作
- Spike(task-dee3642e)验证:Agent 重启后必须先 `ensureSession` (resume) 再 fork,直接 fork 会失败(与 Codex 一致)
- 支持 `upToMessageId` 从对话中间分叉(本次不启用,默认 full copy)

### 2.2 Codex 的 fork

- 通过 `patches/@agentclientprotocol+codex-acp+0.0.44.patch` 给 codex-acp 打补丁实现
- 底层调 codex 的 `thread/fork` 协议(`codexClient.threadFork({ threadId })`)
- thread 由 codex 主程序持久化在 `~/.codex/sessions/`,底层 transcript 文件不依赖源 ACP 连接活着
- **但 AI Studio 层(`src/acp/host.ts`)必须源 ACP session 在 `conn.acpSessions` Map 里**,否则 `forkSession` 找不到 acpSessionId。Agent 重启后 Map 清空,直接 fork 会报错"Session X 没有对应的 ACP session"
- Spike(task-ee5df625)验证:Agent 重启后必须先 `ensureSession` (resume) 再 fork,直接 fork 会失败
- **PR1 修复**:`forkSession` 加 DB fallback——`conn.acpSessions.get(sourceSessionId) ?? sessionStore.get(sourceSessionId)?.acp_session_id`,这样 Agent 重启后也能 fork 模板会话

### 2.3 当前代码的 bug(模板功能的前置修复)

`src/acp/host.ts:576-601`:
```ts
async forkSessionFromAcpSessionId(agentId, sourceAcpSessionId, targetSessionId, context) {
  let conn = acpHost.agents.get(agentId)
  if (!conn) {
    await acpHost.startAgent(agentId)   // Agent 没活就重启
    conn = acpHost.agents.get(agentId)
  }
  // ...
  const result = await conn.connection.unstable_forkSession({
    sessionId: sourceAcpSessionId,      // 这里期望传 acp session ID
    // ...
  })
}
```

调用方 `src/core/sessions.ts:244 copySession`:
```ts
const source = sessionStore.get(sourceSessionId)
if (!source.acp_session_id) throw new Error('当前会话暂无可复制的运行时上下文')
void completeCopiedSessionFork(source, copied.id, source.acp_session_id, projectContext)
```

**问题**:这里直接从数据库取 `source.acp_session_id`,理论上能工作。但 `acpHost.forkSession`(非 FromAcpSessionId 版本,`src/acp/host.ts:563`)用的是 `conn.acpSessions.get(sourceSessionId)` 内存 Map——Agent 重启后是空的。

**PR1 修复**:`forkSession` 加 DB fallback,优先用内存 Map(快),fallback 到数据库(慢但可靠):
```ts
async forkSession(agentId, sourceSessionId, targetSessionId, context) {
  let conn = acpHost.agents.get(agentId)
  const sourceAcpSessionId = conn?.acpSessions.get(sourceSessionId)
    ?? sessionStore.get(sourceSessionId)?.acp_session_id
    ?? undefined
  if (!sourceAcpSessionId) throw new Error(`Session ${sourceSessionId} 没有对应的 ACP session`)
  if (!conn) {
    await acpHost.startAgent(agentId)
    conn = acpHost.agents.get(agentId)
  }
  if (!conn) throw new Error(`Agent ${agentId} 未运行`)
  return acpHost.forkSessionFromAcpSessionId(agentId, sourceAcpSessionId, targetSessionId, context)
}
```

这样模板功能新增的 instantiate 路径(走 `forkSession` 而非 `forkSessionFromAcpSessionId`)也能在 Agent 重启后工作。

## 三、用户流程

### 3.1 发布为模板

1. 会话右键菜单(PC)/ 长按菜单(移动端),点"发布为模板"
2. 弹窗输入:模板名称(必填)、描述(选填)
3. 后端调 `acpHost.forkSessionFromAcpSessionId(agentId, sourceAcpSessionId, templateSessionId, context)`
4. fork 出的新会话标记为"模板会话":`sessions.is_template = 1`
5. 在 `session_templates` 表建一条记录,关联模板会话
6. 提示"已发布为模板"

### 3.2 从模板新建

1. SessionBar 的"+"按钮改成下拉:"空白会话" / "从模板新建"
2. 选"从模板新建"→ 弹出模板选择器(显示当前 Agent 的所有模板)
3. 选模板 → 后端调 `instantiateSessionTemplate(templateId)`:
   - 取模板记录,拿到 `template_session_id`
   - 从数据库取模板会话的 `acp_session_id`:`sessionStore.get(templateSessionId)?.acp_session_id`
   - 再 fork 一次:`forkSessionFromAcpSessionId(agentId, templateAcpSessionId, newSessionId, context)`
   - 新会话 `is_template = 0`
   - 模板 `use_count += 1`
4. 前端切到新会话,可继续对话

### 3.3 模板管理

- PC:设置页加"会话模板"入口,或顶栏单独入口 → 模板管理页
- 移动端:设置页加"会话模板"项
- 管理页功能:列表 / 编辑名称描述 / 删除 / 查看 source session(只读跳转)

### 3.4 删除模板

- 删除 `session_templates` 记录
- 同时关闭并删除关联的模板会话(`is_template=1` 的 session)
- 模板会话的 transcript 文件由 Claude Code/Codex 自身的 session 清理机制处理(本次不主动删 jsonl,见 §10 未决)

## 四、数据模型

### migration 041:session-templates

```sql
CREATE TABLE session_templates (
  id TEXT PRIMARY KEY,                    -- tpl-sess-{uuid8}
  name TEXT NOT NULL,                     -- 模板名称
  description TEXT,                       -- 模板描述
  agent_id TEXT NOT NULL,                 -- 绑定 Agent(模板只在该 Agent 下可见)
  project_id TEXT,                        -- 项目级模板,NULL = 跨项目可见
  runtime TEXT NOT NULL,                  -- claude / codex / mock
  source_session_id TEXT NOT NULL,        -- 发布时的源会话(追溯用)
  template_session_id TEXT NOT NULL,      -- fork 出的模板会话(用于再 fork)
  icon TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (template_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_templates_agent ON session_templates(agent_id);
CREATE INDEX idx_session_templates_project ON session_templates(project_id);
```

### sessions 表加列(同一 migration)

```sql
ALTER TABLE sessions ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
```

`is_template = 1` 的会话:
- 不出现在普通会话列表(`sessionStore.listWithRuntimeState` 等列表查询加 `WHERE is_template = 0`)
- 不能直接发消息(`sessionManager.sendPrompt` 入口校验,报错"模板会话不能直接发消息,请先从模板新建")
- 只能通过模板管理页查看/删除

## 五、后端实现

### 5.1 Store(`src/store/session-templates.ts`)

```ts
export interface SessionTemplateRow {
  id: string
  name: string
  description: string | null
  agentId: string
  projectId: string | null
  runtime: string
  sourceSessionId: string
  templateSessionId: string
  icon: string | null
  useCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export const sessionTemplateStore = {
  create(input): SessionTemplateRow,
  get(id): SessionTemplateRow | undefined,
  list(filter?: { agentId?: string; projectId?: string }): SessionTemplateRow[],
  update(id, fields): SessionTemplateRow | undefined,
  delete(id): void,
  incrementUseCount(id): void,
}
```

### 5.2 Core(`src/core/session-templates.ts`)

```ts
export const sessionTemplateManager = {
  async publishSessionAsTemplate(params: {
    sourceSessionId: string
    name: string
    description?: string
    icon?: string
  }): Promise<SessionTemplateRow> {
    // 1. 校验源会话存在、非模板、非生成中
    // 2. 校验源会话有 acp_session_id(无则报错"暂无可复制的上下文")
    // 3. sessionStore.create({ agentId, projectId }) 建模板会话 placeholder
    // 4. forkSessionFromAcpSessionId(agentId, sourceAcpSessionId, templateSessionId, context)
    // 5. sessions.is_template = 1
    // 6. sessionTemplateStore.create({...})
    // 7. 返回模板记录
  },

  async instantiateSessionTemplate(templateId: string): Promise<SessionRow> {
    // 1. 取模板记录
    // 2. 取模板会话的 acp_session_id(从数据库,不从内存 Map)
    // 3. sessionStore.create({ agentId, projectId }) 建新会话 placeholder
    // 4. forkSessionFromAcpSessionId(agentId, templateAcpSessionId, newSessionId, context)
    // 5. 新会话 is_template = 0
    // 6. incrementUseCount(templateId)
    // 7. 返回新会话
  },

  deleteTemplate(templateId: string): void {
    // 1. 取模板记录
    // 2. 关闭并删除模板会话(is_template=1 的 session)
    // 3. 删除 session_templates 记录
  },
}
```

### 5.3 RPC(`src/gateway/rpc/session-templates.ts`)

```
session_templates.list         → 模板列表(按 agentId/projectId 过滤)
session_templates.get          → 模板详情
session_templates.publish      → 发布会话为模板
session_templates.instantiate  → 从模板新建会话
session_templates.update       → 更新 name/description/icon
session_templates.delete       → 删除模板
```

### 5.4 AI 工具(`src/tools/handlers/core/session-template-tools.ts`)

```ts
export const listSessionTemplatesHandler: ToolHandler = {
  name: 'core.session.template.list',
  description: '列出会话模板(可按 agentId 过滤)',
}

export const publishSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.publish',
  description: '把当前会话发布为模板。模板是会话的完整镜像(ACP fork),新建时从模板 fork 出完整上下文。',
  inputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', description: '要发布为模板的会话 ID' },
      name: { type: 'string', description: '模板名称' },
      description: { type: 'string', description: '模板描述' },
    },
    required: ['sessionId', 'name'],
  },
}

export const instantiateSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.instantiate',
  description: '从模板新建会话,新会话继承模板的完整对话上下文(ACP fork)',
  inputSchema: {
    type: 'object',
    properties: { templateId: { type: 'string' } },
    required: ['templateId'],
  },
}

export const deleteSessionTemplateHandler: ToolHandler = {
  name: 'core.session.template.delete',
}
```

### 5.5 sessions 表查询过滤

`sessionStore.listWithRuntimeState` 和 `listByAgent` 等列表查询都加 `WHERE is_template = 0`,确保模板会话不混进普通会话列表。

`sessionManager.sendPrompt` 入口加校验:
```ts
if (session.is_template) throw new Error('模板会话不能直接发送消息,请先从模板新建会话')
```

## 六、前端实现

### 6.1 PC(`ui/src/pages/`)

**SessionBar 新建按钮**(`ui/src/pages/workspace/SessionBar.tsx:144`):
- 当前是 `<button onClick={() => onNewSession(agent.id)}>` 直接触发
- 改成下拉菜单:`空白会话` / `从模板新建...`
- 选"从模板新建"→ 打开 `<TemplatePickerModal agentId={agent.id} onSelect={...} />`

**会话右键菜单**(`ui/src/pages/Workspace.tsx:1130`):
- 加一项"发布为模板"
- 点击 → 打开 `<PublishTemplateModal sessionId={...} onPublished={...} />`

**模板管理页**:
- 路由 `/templates`
- 顶栏入口:设置图标旁加"模板"入口,或设置页内嵌 tab
- 列表展示:名称 / 描述 / Agent / 来源会话 / 使用次数 / 创建时间 / 操作(编辑/删除)
- 编辑:行内编辑 name/description,或弹窗

**sessionStore** 新增方法:
```ts
listSessionTemplates: (agentId?: string) => Promise<SessionTemplateData[]>
publishSessionTemplate: (sessionId, name, description?) => Promise<SessionTemplateData>
instantiateSessionTemplate: (templateId) => Promise<SessionData>
deleteSessionTemplate: (templateId) => Promise<void>
```

### 6.2 移动端(`mobile/src/`)

**SessionListPage 新建按钮**(`mobile/src/pages/SessionListPage.tsx:268`):
- 当前是直接 `handleNewSession`
- 改成弹出 ActionSheet:`空白会话` / `从模板新建`
- 选"从模板新建"→ 打开 `<TemplatePickerSheet>`

**会话长按菜单**:
- 加"发布为模板"
- 点击 → `<PublishTemplateSheet>`

**SettingsPage**(`mobile/src/pages/SettingsPage.tsx`):
- 在"操作"区块上方加"会话模板"区块,点击跳转 `<TemplateListPage>`

**TemplateListPage**(新页面):
- 模板卡片列表
- 点击模板:查看详情 / 编辑 / 删除

## 七、边界与降级

### 7.1 源会话已删除
模板管理页显示"来源会话已删除",模板本身仍可用(因为模板会话是独立的 fork)。

### 7.2 模板会话的 ACP 连接断开
- `instantiate` 时,`forkSessionFromAcpSessionId` 内部会 `startAgent` 重启 Agent
- 数据库 fallback 拿到 `acp_session_id`,直接 fork
- Claude Code/Codex 底层去读 transcript 文件,不需要 ACP 连接活着

### 7.3 源会话没有 acp_session_id
- 报错"该会话暂无可复制的上下文(可能从未启动过 Agent)"
- 这种会话不能发布为模板

### 7.4 模板会话被误删
- `session_templates.template_session_id` 有 FK + ON DELETE CASCADE
- 模板会话被删 → 模板记录自动删
- 反之不成立:删模板记录时,手动关闭+删除模板会话

### 7.5 不支持的功能
- 不支持跨 Agent 用模板(模板绑定 agentId,因为 fork 必须用同 runtime 的 Agent)
- 不支持模板内嵌套模板(模板会话 `is_template=1`,不能发布为模板)
- 不支持模板版本管理(改模板 = 重新发布)

## 八、AI 工具使用场景

### 场景 1:PM 把"需求梳理会话"发布为模板
PM 完成一次需求梳理后,把会话发布为模板"PRD 调研模板"。下次开新需求时,从模板新建,新会话继承上次的完整上下文(PM 的角色设定 + 调研方法论 + 输出格式),直接进入新需求。

### 场景 2:Agent 自动发布
Agent 在 task 完成后,调 `core.session.template.publish` 把当前会话发布为模板,供后续类似任务复用。AI 工具的 description 要明确:"模板是完整对话镜像(ACP fork),不是 system prompt,新建时整个上下文都会被复制。"

### 场景 3:从模板 instantiate
Agent 调 `core.session.template.instantiate(templateId)`,拿到的 session 已经有完整上下文,直接 `core.session.sendPrompt` 继续对话。

## 九、PR 拆分

### PR1(前置):fork ACP session ID fallback + is_template 基础设施
- `src/acp/host.ts:563 forkSession` 加 `sessionStore.get(...)?.acp_session_id` fallback(让 `forkSession` 也能在 Agent 重启后工作)
- migration 041:sessions 加 `is_template` 列 + `session_templates` 表
- `sessionStore.listWithRuntimeState` 等列表查询加 `WHERE is_template = 0`
- `sessionManager.sendPrompt` 加 `is_template` 校验
- 单测:Agent 重启后(清空 `conn.acpSessions`)仍能 fork

### PR2(主功能):Store + Core + RPC
- `src/store/session-templates.ts`
- `src/core/session-templates.ts`
- `src/gateway/rpc/session-templates.ts`
- 单测:publish / instantiate / delete

### PR3:AI 工具
- `src/tools/handlers/core/session-template-tools.ts`
- 注册到 `tools/handlers/core/index.ts`
- 4 个工具:list / publish / instantiate / delete

### PR4:PC 前端
- SessionBar 新建下拉
- 右键菜单加"发布为模板"
- TemplatePickerModal + PublishTemplateModal
- 模板管理页 `/templates`
- sessionStore 新增方法

### PR5:移动端前端
- SessionListPage 新建 ActionSheet
- 长按菜单加"发布为模板"
- TemplatePickerSheet + PublishTemplateSheet
- SettingsPage 加"会话模板"入口
- TemplateListPage 新页面

## 十、风险与未决

1. **Codex fork 的稳定性**:codex-acp 的 fork 是通过 patch 补的,不是官方原生。需要在 PR2 阶段做端到端验证:发布模板 → Agent 重启 → instantiate → 新会话能继续对话
2. **模板会话的 transcript 文件清理**:删模板时,只删数据库记录,Claude Code/Codex 自身的 jsonl 文件不主动清理。长期使用可能留下垃圾文件。**未决**:是否要在删模板时主动删 transcript 文件?需要调研 Claude Code SDK 是否提供 deleteSession API
3. **模板数量上限**:用户发布大量模板后,模板选择器会很长。**未决**:是否要限制每 Agent 的模板数量?或加分页/搜索?
4. **模板跨项目**:当前设计 `project_id` 字段支持跨项目模板,但前端选择器只显示当前项目的模板。**未决**:是否允许跨项目模板?如果允许,选择器要分"我的模板"和"项目模板"两栏

## 十一、验收标准

- [ ] PC:右键会话 → 发布为模板 → 模板管理页可见
- [ ] PC:SessionBar "+" → 从模板新建 → 新会话继承完整上下文
- [ ] PC:模板管理页能编辑名称描述、删除模板
- [ ] 移动端:长按会话 → 发布为模板
- [ ] 移动端:新建按钮 ActionSheet → 从模板新建
- [ ] 移动端:设置页 → 会话模板 → 列表/编辑/删除
- [ ] **Agent 重启后,模板仍能 instantiate(核心验收点)**
- [ ] AI 工具 `core.session.template.publish/list/instantiate/delete` 全部可用
- [ ] 模板会话不出现在普通会话列表
- [ ] 模板会话不能直接发消息(报错提示)
- [ ] 同一模板多次 instantiate 互不影响

## 附录 A:相关代码引用

- `src/core/sessions.ts:244` — copySession(现有 ACP fork 路径,模板发布复用)
- `src/core/sessions.ts:589` — completeCopiedSessionFork
- `src/acp/host.ts:563` — forkSession(用内存 Map,需加 DB fallback)
- `src/acp/host.ts:576` — forkSessionFromAcpSessionId(直接传 acpSessionId,正确)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:664` — Claude Code SDK forkSession 原生支持
- `node_modules/@agentclientprotocol/claude-agent-acp/dist/acp-agent.js:357` — Claude Code ACP unstable_forkSession 实现
- `patches/@agentclientprotocol+codex-acp+0.0.44.patch:40` — Codex fork patch
- `ui/src/pages/workspace/SessionBar.tsx:144` — PC 新建按钮
- `ui/src/pages/Workspace.tsx:1130` — PC 右键菜单
- `mobile/src/pages/SessionListPage.tsx:268` — 移动端新建按钮
- `mobile/src/pages/SettingsPage.tsx` — 移动端设置页
