# 任务协作工具改造方案

> 基于 `docs/design/task-collaboration-tools.md` 原始设计,对齐实现与设计偏离点,补齐前端管理 UI。
>
> 日期:2026-07-10
> 作者:PM Agent

## 一、背景

原始设计文档定义了 11 个 `studio.task.*` 工具,实现质量较高(10/11 对齐),但存在三类偏离:

1. **`task.create` 参数污染**:`selfExecute` 分支是设计外的"对话任务化"捷径,污染了 createTask / CreateTaskInput / handler / system prompt / master prompt 五处
2. **Prompt 误导**:system prompt 教 AI 用不存在的 `acceptanceCriteria` 参数;master prompt 同样
3. **前端管理 UI 死代码**:`DetailActions` 声明了 `onAddStep` / `onEdit` 但 `TaskDetailInline` 不传,加步骤按钮永远不渲染;store 的 `addStep/updateStep/removeStep` 方法零调用;老 `TaskDetailDrawer` 残留且不认 steps

**因果**:AI 用 `selfExecute=true` 创建的任务无 steps → 前端 `isCollabTask` 返回 false → 走单 Agent 展示路径 → 用户看不到任何步骤。

## 二、决策:selfExecute 从 task.create 搬到 task.createSimple

### 2.1 问题根源

selfExecute 原来放在 `task.create` 里,导致 `task.create` 塞了两个职责:
1. 建协作空壳(selfExecute=false)→ 多 Agent 编排
2. 对话任务化(selfExecute=true)→ 一步自做

这两个职责心智模型完全不同:
- 协作空壳是"先建容器,再编排步骤,最后 start"
- 对话任务化是"一步到位,自己干,不用 start"

而 `task.createSimple` 本来就是为"一步任务"设计的,当前只支持"派给别人"。**selfExecute 本质上就是 createSimple 的"自做模式"**,应该放那边。

### 2.2 新设计:selfExecute 搬到 createSimple

`task.createSimple` 两种模式:
- `selfExecute=true`(对话任务化,自做):建默认 step(assignee=自己, sessionId=当前会话),跳过 prompt 注入,不 dispatch,step/task 直接 running
- `selfExecute=false`(默认,派发给别人):建默认 step(assignee=传入 assignee),注入 prompt,dispatch 派发,step/task running

`task.create` 去掉 selfExecute,只建空壳。

### 2.3 三个工具语义对称

| 工具 | 场景 | step | prompt 注入 | 派发 | 要 start? |
|---|---|---|---|---|---|
| `task.create` | 协作任务(多 step 编排) | 无(空壳) | 无 | 无 | ✅ 要(step.add 编排后) |
| `task.createSimple` + `selfExecute=true` | 对话任务化(自做) | 1 默认 | ❌ 跳过 | ❌ 不派 | ❌ 不要 |
| `task.createSimple` + `selfExecute=false` | 简单任务派给别人 | 1 默认 | ✅ 注入 | ✅ 派发 | ❌ 不要 |

### 2.4 什么时候用哪个(AI 判断指引)

- 用户在当前对话说"帮我修 X / 重构 Y / 调研 Z" → `task.createSimple(selfExecute=true)`
- PM 要派简单任务给别的 Agent → `task.createSimple(assignee=目标)`
- PM 要编排多 Agent 协作(方案→开发→测试→验收) → `task.create` + 多个 `step.add` + `task.start`

### 2.5 projectId 不暴露给 AI

三个工具统一:projectId 从 context 拿(当前会话的项目),不暴露给 AI。AI 不能跨项目建任务,避免"在 A 项目会话里建了 B 项目任务"的错乱。

## 三、改造清单

### 3.1 后端:task.create 去掉 selfExecute + createSimple 加 selfExecute

#### 3.1.1 `task.create` 工具 schema(seed.ts:540-565)

**改前**:
```
参数:title, description, selfExecute?, projectId?
required: [title, description]
```

**改后**:
```
参数:title, description
required: [title, description]
```

去掉:`selfExecute` / `projectId`
- `selfExecute` 搬到 `task.createSimple`(见 3.1.6)
- `projectId` 从 context 拿,不暴露给 AI(见 2.5)

#### 3.1.2 `task.create` 工具描述改写

```
创建协作任务空壳。仅建空壳,后续 step.add 编排 + task.start 启动。用于多 Agent 协作编排。
```

#### 3.1.3 `createTask` 逻辑(tasks.ts:37-97)

**去掉 selfExecute 分支**(tasks.ts:40-94 整段),只留空壳创建:
1. taskStore.create() 建空壳(status=draft,无 assigned_agent_id,无 step)
2. 发 task:update + task:created 事件
3. 返回 task(status=draft)

去掉:`selfExecuteAgentId` / `selfExecuteSessionId` 入参,去掉 selfExecute 相关逻辑。

#### 3.1.4 `CreateTaskInput` 清理(store/tasks.ts)

**去掉字段**:
- `selfExecute`(搬到 createSimple)
- `assignAgentId` / `sessionMode` / `sessionId` / `executionModeId` / `promptTemplate` / `ruleName` / `images`(老残留)

**保留字段**:
- `title` / `description` / `source` / `projectId`

#### 3.1.5 `task.create` handler(studio-task-crud-tools.ts:33-91)

对齐 3.1.1 的 schema:
- 去掉 `selfExecute` / `projectId` 参数解析
- `projectId` 强制从 `context.projectId` 拿
- 不再传 `selfExecuteAgentId` / `selfExecuteSessionId` 给 createTask

#### 3.1.6 `task.createSimple` 加 selfExecute 参数

**schema 改前**:
```
参数:title, description, assignee(必填), sessionId?, projectId?
required: [title, description, assignee]
```

**schema 改后**:
```
参数:title, description, selfExecute?(可选,默认 false), assignee(selfExecute=false 时必填), sessionId?
required: [title, description]
```

**工具描述改写**:
```
创建一步任务。两种模式:selfExecute=true(对话任务化,自做) / selfExecute=false(派发给别人)。自动建默认 step + 自动 start。
```

**`createSimpleTask` 逻辑(task-simple.ts)加 selfExecute 分支**:

selfExecute=true 分支(新增,从 taskManager.createTask 搬过来):
1. 校验 context.agentId + context.sessionId 存在
2. taskStore.create() 建任务
3. 建默认 step(assignee=context.agentId, sessionId=context.sessionId)
4. step 直接 running,task 直接 running
5. 跳过 prompt 注入(不调 dispatchStep)
6. 返回 { task, defaultStepId, sessionId: context.sessionId }

selfExecute=false 分支(现有派发逻辑保留):
1. 校验 assignee 非空
2. taskStore.create() 建任务
3. 建默认 step(assignee=传入 assignee)
4. step ready → dispatch → running
5. 注入 prompt 到目标会话
6. 返回 { task, defaultStepId, sessionId }

#### 3.1.7 `task.report` 老逻辑处理(studio-task-flow-tools.ts)

当前 `stepId` 不传时走 `taskManager.reportTask`(老单 Agent 逻辑)。

新方案下所有任务都有 step(createSimple 的 selfExecute/派发都建默认 step,协作任务靠 step.add),所以:
- `stepId` 可选保留(向后兼容老任务)
- 但 system prompt / master prompt 改为引导 AI 一定带 `stepId`
- 老任务逐步淘汰后,`stepId` 改必填

### 3.2 Prompt 修正

#### 3.2.1 `ai-ide-system-prompt.ts:8`

**改前**:
```
你的第一个动作必须是 `studio.task.create(selfExecute=true)` 创建并认领
```

**改后**:
```
你的第一个动作必须是 `studio.task.createSimple(selfExecute=true)` 创建并认领。
该工具会建一个默认 step(assignee=你自己, sessionId=当前会话),跳过 prompt 注入(用户消息就是任务上下文),任务直接进入 running。
后续用 `studio.task.report(taskId, stepId, agentStatus, reportMd)` 汇报——必须带 stepId(从 task.createSimple 返回的 defaultStepId)。
```

#### 3.2.2 `master-prompt.ts:24,53,69` 去 `acceptanceCriteria` + 改工具名

`acceptanceCriteria` 全代码库不存在,是误导。

**改前(line 24)**:
```
调用 `studio.task.create({title, description, assignAgentId, acceptanceCriteria})`
```

**改后**:
```
调用 `studio.task.createSimple({title, description, selfExecute:true})`
```

**改前(line 53)**:
```
开任务时写清 `description` 和 `acceptanceCriteria`
```

**改后**:
```
开任务时写清 `description`(任务目标文档)
```

**改前(line 69 示例)**:
```
`studio.task.create({title:"重构登录模块", description:"cookie 改 JWT", assignAgentId:"你的AgentId", acceptanceCriteria:["改成JWT","所有调用点更新","测试通过"]})`
```

**改后**:
```
`studio.task.createSimple({title:"重构登录模块", description:"cookie 改 JWT,要求:改成JWT / 所有调用点更新 / 测试通过", selfExecute:true})`
```

(验收标准写进 description,不再单独传)

### 3.3 前端:步骤管理 UI 补全

#### 3.3.1 `TaskDetailInline.tsx` 接上 `onAddStep` / `onEdit`

**位置**:TaskDetailInline.tsx:147-157

**改动**:
- 新增 `handleAddStep`(打开 StepModal,空表单)
- 新增 `handleEditStep`(打开 StepModal,预填当前 step)
- `DetailActions` 传 `onAddStep={handleAddStep}`(collab 任务时)
- `StepList` 行点击传 `onSelectStep={handleEditStep}`

#### 3.3.2 新建 `StepModal.tsx`(或 `StepForm.tsx`)

**位置**:`ui/src/pages/workspace/task-collab/StepModal.tsx`

**表单字段**:
- 标题(必填)
- 描述(必填,做什么)
- 分派 Agent(下拉,从 agents 列表选,可选=待认领)
- 依赖(多选,从当前任务的 steps 里选,显示标题)

**提交**:
- 新建 → `addStep({ taskId, title, description, assignee, dependsOn })`
- 编辑 → `updateStep({ taskId, stepId, title, description, assignee, dependsOn })`

**提交后**:
- 任务自动回 draft(后端行为),提示"任务已回 draft,改完点启动任务"
- 关闭弹窗,刷新 steps

#### 3.3.3 `StepList.tsx` 加删除按钮

**位置**:StepList.tsx:34-145(StepRow)

**改动**:
- 每行右侧加删除图标(Trash2)
- 点击弹确认("删除步骤 X?任务会回 draft")
- 确认 → `removeStep(taskId, stepId)`

#### 3.3.4 创建任务入口拆分

当前 `createTask` store 方法(task.store.ts:127)是老的单 Agent 路径。

**改动**:
- 创建任务弹窗加模式选择:"协作任务" / "简单任务" / "对话任务化(当前会话)"
- "协作任务" → `tasks.create`(空壳) → 进详情页加步骤 → 启动
- "简单任务" → `tasks.createSimple`(指定 assignee) → 自动派发
- "对话任务化" → 只在 AI 侧用,前端不暴露(用户手动建任务不会用这个)

#### 3.3.5 废弃 `TaskDetailDrawer.tsx`,统一用 `TaskDetailInline`

**老 Drawer 问题**:
- 状态模型有 `reviewing` / `blocked`(line 19,27-30),设计里没有
- 完全不处理 steps
- 被 `ContextPanel.tsx:59` 和 `TaskBoard.tsx:153` 引用

**改动**:
- `ContextPanel.tsx` 改用 `TaskDetailInline`
- `TaskBoard.tsx` 改用 `TaskDetailInline`(同时清理本地同名函数 line 204)
- `TaskDetailDrawer.tsx` 删除或标记 deprecated

### 3.4 设计文档同步

原始设计文档 `task-collaboration-tools.md` 需同步:

#### 3.4.1 第四章 `task.create` 去掉 selfExecute

参数定义改为:
```
参数:
  title         string    必填
  description   string    必填  任务目标文档
```

说明改为:
```
- 建空壳任务,无 step 无 assignee,status=draft
- 后续用 task.step.add 编排步骤 + task.start 启动派发
- 用于多 Agent 协作编排
- 对话任务化(自做)用 task.createSimple(selfExecute=true)
- 简单派发(派给别人)用 task.createSimple(selfExecute=false)
```

#### 3.4.2 第四章 `task.createSimple` 加 selfExecute

参数定义改为:
```
参数:
  title         string    必填
  description   string    必填
  selfExecute   boolean   可选  true=对话任务化(自做);false=派发给别人。默认 false
  assignee      string    selfExecute=false 时必填
  sessionId?    string    可选  selfExecute=false 时指定会话
```

说明补两种模式的详细行为(见 task-collaboration-tools.md 4.1 节)。

#### 3.4.3 第九章兼容性表更新

```
| studio.task.create | 保留;去掉 assignee/sessionMode/sessionId/executionModeId/selfExecute 参数;
                       只建空壳,职责单一(多 Agent 协作编排) |
| studio.task.createSimple | 保留;新增 selfExecute 参数(从 task.create 搬过来):
                              true=对话任务化(自做),false=派发给别人(默认) |
```

#### 3.4.4 第七章场景示例更新

场景 2.5 的 `task.create(selfExecute=true)` 改为 `task.createSimple(selfExecute=true)`。

## 四、任务拆分(派工)

### 任务 1:后端改造(派 coder-codex,复杂)

**范围**:3.1 全部 + 3.4 设计文档同步
**改动文件**:
- `src/store/tasks.ts`(CreateTaskInput 去掉 selfExecute)
- `src/core/tasks.ts`(createTask 去掉 selfExecute 分支)
- `src/core/task-simple.ts`(createSimpleTask 加 selfExecute 分支)
- `src/tools/handlers/studio-task-crud-tools.ts`(task.create handler 去掉 selfExecute/projectId + createSimple handler 加 selfExecute)
- `src/tools/seed.ts`(task.create schema 去掉 selfExecute/projectId + createSimple schema 加 selfExecute)
- `docs/design/task-collaboration-tools.md`(同步)
- `docs/design/task-collaboration-refactor-plan.md`(同步)

**验收**:
- `task.create` schema 只有 title/description
- `task.createSimple` schema 有 title/description/selfExecute/assignee/sessionId
- selfExecute=true 建默认 step,跳过 prompt,不 dispatch,task running
- selfExecute=false 建默认 step,注入 prompt,dispatch,task running
- projectId 从 context 拿,两个工具都不暴露
- tsc + vitest 全过
- 设计文档同步

### 任务 2:Prompt 修正(派 coder-prd,简单)

**范围**:3.2 全部
**改动文件**:
- `src/core/ai-ide-system-prompt.ts`
- `src/core/master-prompt.ts`

**验收**:
- 去掉所有 `acceptanceCriteria`
- system prompt 用 `task.createSimple(selfExecute=true)` 而非 `task.create(selfExecute=true)`
- master prompt 示例参数正确

### 任务 3:前端 isCollabTask 修复 + 步骤管理 UI(派 coder-codex,复杂)

**范围**:3.3.1 / 3.3.2 / 3.3.3 + isCollabTask 修复
**改动文件**:
- `ui/src/pages/workspace/task-collab/step-helpers.ts`(isCollabTask 改:有 step 就走 collab 路径)
- `ui/src/pages/workspace/task-collab/TaskDetailInline.tsx`(接 onAddStep/onEdit)
- `ui/src/pages/workspace/task-collab/StepModal.tsx`(新建)
- `ui/src/pages/workspace/task-collab/StepList.tsx`(加删除)

**验收**:
- selfExecute 任务(单步)显示步骤区 + step 汇报时间线
- createSimple 派发任务(单步)显示步骤区
- 协作任务(多步)显示步骤区
- collab 任务详情显示"加步骤"按钮
- 点击打开 StepModal,填表提交后步骤加到列表
- 步骤行可点编辑,可删
- 加/改/删后任务自动回 draft,UI 提示"点启动任务恢复"

### 任务 4:前端创建入口 + 老 Drawer 清理(派 coder-codex,复杂)

**范围**:3.3.4 / 3.3.5
**改动文件**:
- `ui/src/stores/task.store.ts`(createTask 方法拆分)
- `ui/src/pages/workspace/task-collab/CreateTaskModal.tsx`(加模式选择)
- `ui/src/pages/dashboard/ContextPanel.tsx`(换 TaskDetailInline)
- `ui/src/pages/TaskBoard.tsx`(换 TaskDetailInline)
- `ui/src/components/tasks/TaskDetailDrawer.tsx`(删除或标 deprecated)

**验收**:
- 创建任务可选"协作任务"/"简单任务"
- Dashboard / TaskBoard 进详情都能看到 steps
- 老 Drawer 不再被引用

## 五、执行顺序

1. **任务 1 + 任务 2 并行**(后端 + prompt,互不依赖)
2. **任务 3 + 任务 4 串行**(3 先补管理 UI,4 再清理老 Drawer)
3. 每个任务独立 worktree + code-review

## 六、风险

1. **selfExecute 从 task.create 搬到 createSimple**:已有的 selfExecute 任务(如果有)不受影响,数据结构没变(都有默认 step)。但 AI 调用习惯要改(system prompt 引导)。
2. **`task.report` 老逻辑**:stepId 不传走老逻辑,如果 AI 忘传 stepId 会走老路径。system prompt 要强调必带 stepId。
3. **老 Drawer 删除**:ContextPanel / TaskBoard 的交互可能和 TaskDetailInline 不完全一致,需测试。
4. **description 改必填**:可能破坏现有调用方(定时规则、事件触发),需检查 `taskManager.createTask` 的其他调用点。
5. **projectId 不暴露**:要确认所有调用方(定时规则、事件触发)都能从 context 拿到 projectId,否则需要兜底。

## 七、验收标准(整体)

- [ ] `task.create` schema 只有 title/description(projectId 从 context 拿)
- [ ] `task.createSimple` schema 有 title/description/selfExecute/assignee/sessionId
- [ ] `createSimple(selfExecute=true)` 建默认 step,跳过 prompt,不 dispatch,task running
- [ ] `createSimple(selfExecute=false)` 建默认 step,注入 prompt,dispatch,task running
- [ ] `task.create` 只建空壳,status=draft,无 step 无 assignee
- [ ] system prompt + master prompt 无 acceptanceCriteria
- [ ] system prompt 用 `task.createSimple(selfExecute=true)`
- [ ] 前端 selfExecute/createSimple/协作 任务都显示步骤区
- [ ] 前端 collab 任务详情显示"加步骤"按钮,可加/改/删步骤
- [ ] 前端创建任务可选协作/简单
- [ ] Dashboard / TaskBoard 进详情能看到 steps
- [ ] 老 TaskDetailDrawer 不再被引用
- [ ] tsc + vitest + build 全过
- [ ] 设计文档同步
