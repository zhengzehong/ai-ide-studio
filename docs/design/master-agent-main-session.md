# Master Agent 主会话 — 最小化方案

> 版本:v1.2(最小化) | 日期:2026-06-27 | 状态:待实施
>
> 本版只做一件事:**给每个 Agent 加一个主会话,注入 Master 角色 prompt**。其他全部不动,先试效果。
>
> v1.2 变更:数据模型只加 `is_primary` 一列(去掉 `type`)。归档继续用现有 `archived_at` 字段,不重复表达。

---

## 一、目标与边界

### 1.1 本次只做

1. sessions 表加 `is_primary` 字段
2. Agent 创建时自动建主会话
3. 已有 Agent 补主会话(一次性迁移)
4. 主会话注入 Master 角色 prompt
5. 左栏主会话置顶 + ⚡ 视觉标识
6. 点 Agent 时默认进主会话(若当前未选会话)

### 1.2 本次不动(明确)

| 不动项 | 原因 |
|--------|------|
| 左栏会话列表展开/折叠方式 | 先试效果,不破坏现有交互 |
| 右栏任务面板 | 现状已可用 |
| 任务创建逻辑 | 现状已可用 |
| 任务挂 Agent 下面的方式 | 现状已可用 |
| 会话 CRUD / 消息持久化 / ACP 通信 | 全保留 |
| 子会话(普通会话)的 prompt | 保持现状,不注入 Worker prompt |
| 子会话自动归档 | 不做,先手动管理 |
| 多 Agent 协作子会话归属 | 不做 |

### 1.3 为什么这么小

先验证"主会话 + Master prompt"这个核心假设是否成立。如果用户觉得主会话有用、Master 行为符合预期,再迭代子会话改造、左栏折叠、任务联动等。**一次只改一个变量,才能归因效果。**

---

## 二、数据模型改动

### 2.1 sessions 表新增字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `is_primary` | INTEGER | `0` | 0/1,主会话标记。1=主会话,0=普通会话 |

**归档不新增字段**:继续用现有 `archived_at`(sessions.ts:23)。主会话归档守卫靠 `is_primary=1` 拦截,不依赖类型枚举。

> 不加 `type` 枚举列。理由:归档已有 `archived_at`;主会话只需 0/1 标记;预留枚举违背最小化原则,将来真需要"临时会话"等新类型再加。
> 不加 `task_id` 字段(本次不动任务-会话关联)。
> 不加 `parent_session_id`(本次不做分支)。

### 2.2 Migration

新增 `src/store/migrations/027-session-primary.ts`(编号接 026-project-meta 之后):

```typescript
import type { Migration } from './index.js'

export const sessionPrimaryMigration: Migration = {
  version: '027',
  name: 'session-primary',
  up: (db) => {
    db.exec(`ALTER TABLE sessions ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`)
  },
}
```

注册到 `src/store/migrations/index.ts` 的 migrations 数组末尾。

`tests/integration/sqlite-migration.test.ts` 期望数组加 `'027'`。

---

## 三、Agent 创建逻辑改动

### 3.1 创建 Agent 时自动建主会话

文件:`src/core/agents.ts`

在 createAgent 流程末尾,Agent 创建成功后,立即创建主会话:

```typescript
// 伪代码
const agent = await agentStore.create(...)

// 自动建主会话
const mainSession = await sessionStore.create({
  agentId: agent.id,
  projectId: agent.project_id,
  title: `${agent.name} 的主会话`,
  isPrimary: true,
})

return agent
```

### 3.2 主会话的不可删/不可归档约束

在 `src/store/sessions.ts` 的 delete / archive 方法里加守卫:

```typescript
// 删除前检查
if (session.is_primary) {
  throw new Error('主会话不可删除')
}
// 归档前检查
if (session.is_primary) {
  throw new Error('主会话不可归档')
}
```

前端右键菜单对主会话隐藏"删除"/"归档"选项。

### 3.3 已有 Agent 补主会话(迁移脚本)

新建 `scripts/backfill-main-sessions.ts`(一次性脚本):

```typescript
// 伪代码
const agents = await agentStore.list()
for (const agent of agents) {
  const existing = await sessionStore.findPrimaryByAgent(agent.id)
  if (!existing) {
    await sessionStore.create({
      agentId: agent.id,
      projectId: agent.project_id,
      title: `${agent.name} 的主会话`,
      isPrimary: true,
    })
    console.log(`为 Agent ${agent.name} 补建主会话`)
  }
}
```

执行时机:migration 027 跑完后,手动执行一次 `npm run backfill:main-sessions`。

`package.json` 加 script:
```json
"backfill:main-sessions": "tsx scripts/backfill-main-sessions.ts"
```

---

## 四、Master 角色 Prompt 注入

### 4.1 注入位置

文件:`src/core/sessions.ts` 或 `src/acp/host.ts`(看现有 prompt 拼装在哪)

主会话启动 ACP 时,在 Agent 原 system prompt 之后,追加 Master 角色 prompt。

### 4.2 Master 角色 Prompt(完整文案)

```
# 你的角色:Master(主会话统筹者)

你现在是 {Agent名} 的【主会话统筹者】模式。这个会话是你的主会话,是你和用户的常驻沟通频道。用户随时会来找你聊,你也随时在这里响应。

## 你的定位

你是用户的**唯一对话入口**。用户不直接管子会话,所有执行都通过你来组织。你是这个 Agent 的"大脑",子会话是你派出去的"手脚"。

## 核心职责

### 1. 理解意图,不急着动手
用户说的话往往模糊。先确认你理解对了:
- 复述用户意图,问"我理解的是 X,对吗?"
- 意图不清时,先问清楚再行动,不要猜

### 2. 判断要不要执行
不是所有对话都要执行。区分:
- **纯咨询/分析**:用户只是问问题、要建议 → 主会话直接答,不开任务
- **要执行的事**:用户要你"做/改/修/实现/调研/重构..." → 开任务

### 3. 开任务,把执行交给子会话
需要执行时,**创建任务**,系统会自动为这个任务开一个子会话:
- 调用 `studio.task.create({title, description, selfExecute:true})`
- 任务创建后,系统会创建默认 step 并由当前 Agent 认领,你在当前任务会话里以 Worker 模式执行
- **不要在主会话里亲自执行细节** —— 主会话只做决策和协调

### 4. 并行多任务
用户要同时做 N 件事 → 开 N 个任务,各开子会话,并行执行:
- 每个任务独立上下文,互不串扰
- 用户问"A 进度怎样" → 你用 `studio.task.get(taskId)` 读任务状态回答
- 用户要改 B 方向 → 你转告 B 子会话,或让用户直接进 B 任务说

### 5. 感知所有任务进度
用户随时可能问你"现在什么情况"。你要主动感知:
- 用户进主会话时,先调用 `studio.task.list` 了解当前任务全貌
- 用户问进度时,用 `studio.task.get` 读具体任务详情
- 不要凭记忆答,用工具查实时状态

### 6. 协调多 Agent 协作
任务可以拉别的 Agent 一起:
- 创建协作任务时先 `studio.task.create({title, description})` 建空壳,再用 step 工具编排并指派其他 Agent
- 或任务进行中,通过 `studio.task.assign` 重新指派
- 多 Agent 协作时,你是协调中心,处理冲突、汇总结果

### 7. 沉淀结论
主会话讨论出的方案、决策、用户偏好,有价值的要沉淀到记忆库(如已配置)。

## 行为准则

### ✅ 应该做的
- 主会话里**先理解、后决策、再派任务**
- 开任务时写清 `description`(任务目标文档),任务步骤靠这个执行
- 用户问进度时,用工具查,不凭记忆
- 主动汇报:"A 任务已完成,B 还在跑,C 阻塞了需要你处理"
- 用户聊的某个点深入了,主动说"这个我开个任务深入做,你进任务说细节"

### ❌ 不应该做的
- **不要在主会话里亲自改代码/跑命令/写文件** —— 开任务让子会话做
- **不要在主会话里钻细节** —— 细节进任务子会话聊
- **不要凭记忆答进度** —— 用 studio.task.get/list 查
- **不要默默执行** —— 开了任务要告诉用户"我开了任务 X,你可以进任务看"

## 典型场景示例

### 场景 1:用户说"帮我重构登录模块"
1. 复述确认:"你是要把现在的 cookie 登录改成 JWT,对吗?"
2. 用户确认后,创建任务:
   `studio.task.create({title:"重构登录模块", description:"cookie 改 JWT,要求:改成JWT / 所有调用点更新 / 测试通过", selfExecute:true})`
3. 告诉用户:"我开了任务'重构登录模块',子会话已启动,你可以进任务说细节,或者在这里等汇报。"

### 场景 2:用户说"A B C D 四个功能同时做"
1. 确认四个功能的目标
2. 开 4 个任务,各自子会话
3. 告诉用户:"4 个任务都开好了,并行跑。我随时帮你盯进度。"
4. 用户问"B 怎样了" → `studio.task.get(B的taskId)` → 回答

### 场景 3:用户说"随便聊聊,你觉得这个架构怎么样"
- 纯咨询,不开任务
- 主会话直接分析讨论,给出建议
- 讨论出方案要落地时,再说"要不要我开任务去做"

### 场景 4:用户进主会话问"现在什么情况"
- `studio.task.list({status:"executing"})` 看在跑的
- `studio.task.list({status:"needs_input"})` 看要处理的
- 汇报:"2 个在跑(A 60%、B 刚开始),1 个等你确认(C 的方案选择)"

## 边界

- 你只管自己这个 Agent 的任务。别的 Agent 的任务不归你管,除非用户让你协调。
- 用户要找别的 Agent → 告诉他去那个 Agent 的主会话。
- 任务卡住超 3 轮 → 主动 `studio.task.request_input` 升级用户。
```

### 4.3 注入实现要点

- `{Agent名}` 用实际 agent.name 替换
- 只对 `is_primary=1` 的会话注入,普通会话(`is_primary=0`)不注入
- 注入位置:Agent 原 system prompt 之后,任务指派 prompt 之前(主会话没有任务指派)

---

## 五、前端最小改动

### 5.1 左栏:主会话置顶 + 标识

文件:`ui/src/pages/Workspace.tsx`

改动点:Agent 展开后的会话列表,**主会话永远排第一**,且带 ⚡ 标识 + "主会话"文字。

```typescript
// 伪代码:agentSessions 排序
const agentSessions = (id: string) => {
  return orderedProjectSessions
    .filter((s) => s.agent_id === id)
    .sort((a, b) => {
      // 主会话永远第一
      if (a.is_primary && !b.is_primary) return -1
      if (!a.is_primary && b.is_primary) return 1
      // 其他按原 sort_order
      return 0
    })
}
```

主会话的渲染加标识:
```tsx
{s.is_primary && <span style={{...}}>⚡</span>}
{sessionTitle(s)}{s.is_primary && ' · 主会话'}
```

### 5.2 点 Agent 默认进主会话

文件:`ui/src/pages/Workspace.tsx`

改动点:点 Agent 行(非展开/折叠按钮)时,如果当前没选会话,自动选主会话。

```typescript
const handleAgentClick = (agentId: string) => {
  const agentMainSession = agentSessions(agentId).find((s) => s.is_primary)
  if (!currentSessionId && agentMainSession) {
    handleSelectSession(agentId, agentMainSession.id)
  } else {
    toggleAgent(agentId)
  }
}
```

> 注意:不破坏展开/折叠交互。用户点展开按钮还是展开,点 Agent 主体才触发进主会话。

### 5.3 右键菜单:主会话隐藏删除/归档

文件:`ui/src/pages/Workspace.tsx` 的 ContextMenu 渲染

```typescript
{!session.is_primary && <MenuItem onClick={handleArchive}>归档</MenuItem>}
{!session.is_primary && <MenuItem onClick={handleDelete}>删除</MenuItem>}
```

### 5.4 不做的 UI

- ❌ 不折叠 Agent(展开/折叠方式不变)
- ❌ 不改右栏任务面板
- ❌ 不加任务点击联动跳子会话
- ❌ 不加"已归档"入口
- ❌ 不改会话标题样式(只加 ⚡ 前缀)

---

## 六、实施步骤(给 coder-prd)

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | migration 027-session-primary.ts + 注册 + 测试更新 | 无 |
| 2 | sessions.ts 加 is_primary 字段读写 + 删除/归档守卫 + findPrimaryByAgent 方法 | 1 |
| 3 | agents.ts createAgent 末尾自动建主会话 | 2 |
| 4 | 主会话 prompt 注入(sessions.ts 或 host.ts) | 2 |
| 5 | backfill-main-sessions.ts 脚本 + package.json script | 2 |
| 6 | Workspace.tsx 主会话置顶排序 + ⚡ 标识 + 点 Agent 进主会话 + 右键守卫 | 2 |
| 7 | 本地跑 backfill 脚本,给现有 3 个 Agent 补主会话 | 5 |
| 8 | npm test / lint / build 验证 | 全部 |

---

## 七、验收清单

- [ ] migration 027 跑通,现有数据不丢
- [ ] 新建 Agent 时自动产生主会话,标题 "{Agent名} 的主会话",is_primary=1
- [ ] 已有 3 个 Agent(coder-prd / coder-glm / PM)执行 backfill 后都有主会话
- [ ] 主会话右键菜单无"删除""归档"选项
- [ ] 直接调 RPC 删除/归档主会话返回错误
- [ ] 主会话启动 ACP 时,Agent 收到的 prompt 含 Master 角色段
- [ ] 普通会话(is_primary=0)启动时不注入 Master prompt
- [ ] 左栏 Agent 展开后,主会话排第一,带 ⚡ 标识和"主会话"文字
- [ ] 点 Agent 主体(当前无选中会话时)自动进主会话
- [ ] 现有功能(展开/折叠、新建会话、任务面板、消息收发)不受影响
- [ ] npm test 通过(runtime-registry 已知失败允许)
- [ ] npm run lint 无新增错误
- [ ] npm run build 通过

---

## 八、已知风险

1. **已有会话迁移**:存量会话 `is_primary` 默认 0,不会有主会话标识。backfill 只补 Agent 的主会话,不动存量会话。存量会话保留原样,用户可手动归档。
2. **Master prompt 注入位置**:需确认现有 prompt 拼装是在 sessions.ts 还是 host.ts,注入点要正确,避免和任务指派 prompt 冲突。
3. **主会话的 ACP 生命周期**:主会话和普通会话一样走 ACP session 生命周期,空闲断开、重连恢复。不特殊处理。
4. **点 Agent 进主会话的交互**:可能与现有"点 Agent 展开/折叠"冲突。需要区分点 Agent 头部和点展开按钮。本次方案:点 Agent 头部(非 chevron)且无当前会话时进主会话,否则展开/折叠。

---

## 九、下一步(本次不做,试效果后再定)

- 左栏 Agent 折叠 + 任务状态角标
- 右栏点任务联动中栏跳子会话
- 子会话(任务会话)注入 Worker prompt
- 子会话任务完成后自动归档
- 会话类型四分法(主/任务/临时/归档)
- AI 记忆库(人定维度,AI 自沉淀自检索)
