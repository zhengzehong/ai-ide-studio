# 任务协作工具集设计文档

> 基于"任务 = 步骤图(DAG)"的多 Agent 协作模型。工具供 AI Agent 调用,前端负责展示。

## 一、核心模型

### 任务(Task)
协作的容器,包含目标文档 + 步骤图。

### 步骤(Step)
任务内的协作节点,最小工作单元。每个 step 绑定一个 assignee(执行 Agent)。

### 依赖(Dependency)
step 之间通过 `dependsOn` 数组表达顺序。step A 的 dependsOn 全 done → step A ready。

### 产出(Artifacts)
step.report(done/milestone) 时可携带产出(commit/文件/文档/链接),下游 step 可查。

---

## 二、任务状态机

只有两个状态:**draft / running**。

```
task.create ──→ draft
draft ──task.start──→ running
running ──任何 step.edit──→ draft(自动回退)
draft ──task.start──→ running(重新启动)
running ──所有 step done──→ completed
```

### 状态行为

| | draft | running | completed |
|---|---|---|---|
| 系统派发 step | ❌ 不派 | ✅ 派 ready 的 step | ❌ |
| step.report | ❌ | ✅ | ❌ |
| step.add/update/remove | ✅ | ✅(触发回 draft) | ❌ |
| task.update | ✅ | ✅ | ❌ |

### 关键规则

1. **draft 状态系统不派发任何 step**,PM 可随便编辑图
2. **running 中任何 step 编辑(add/update/remove)自动回退到 draft**
3. **回 draft 时,已 running 的 step 继续跑完**,但跑完的 report 不解锁下游(draft 不派)
4. **task.start 时系统重新评估全图**,按当前 dependsOn 算状态,该派的派
5. **所有 step done → 任务 completed**

---

## 三、步骤状态

| 状态 | 含义 |
|---|---|
| pending | 等待依赖(依赖未全 done) |
| ready | 可开始(依赖全 done),待派发 |
| running | 执行中(已派给 Agent) |
| done | 完成 |
| blocked | 卡住,等人工决策 |

### 状态流转

```
pending ──依赖全 done──→ ready ──派发──→ running
running ──report(done)──→ done
running ──report(blocked)──→ blocked
blocked ──人工介入后──→ running(继续)或重新评估
```

**注意:没有 rejected 状态。** 审查不通过 = 审查 step done(产出"不通过报告") + 新增修复 step + 新增重审 step + 更新下游依赖。

---

## 四、工具清单

### 4.1 任务容器

#### `task.create`
创建协作任务容器。默认仅建空壳,后续 step.add 编排 + task.start 启动；selfExecute=true 时用于对话任务化。
```
参数:
  title         string    必填  任务标题
  description   string    必填  任务目标文档(背景/需求/验收标准,固定部分)
  selfExecute?  boolean   可选  true=对话任务化(建默认 step,跳过 prompt 注入)
                               false=建空壳,后续 step.add 编排
                               默认 false

返回:
  taskId        string
  defaultStepId string    selfExecute=true 时返回
  status        "draft"|"running"

说明:
  - selfExecute=true:用户在当前对话布置任务时用。建一个默认 step(assignee=自己),
    跳过 prompt 注入(用户消息本身就是任务上下文),任务直接 running。
  - selfExecute=false(默认):建空壳任务,无 step 无 assignee。后续用 task.step.add
    编排 + task.start 启动。用于多 Agent 协作。
  - 简单任务(单 Agent 一步完成)用 task.createSimple,不要用这个
```

#### `task.createSimple`
创建简单任务(单 Agent 一步完成),自动建默认 step + 自动 start,立即派发。
```
参数:
  title         string    必填  任务标题
  description   string    必填  任务目标文档
  assignee      string    必填  分派给哪个 Agent
  sessionId?    string    可选  指定会话(不传系统按 assignee 找 primary 会话)

返回:
  taskId        string
  defaultStepId string    自动建的默认 step ID(用于后续 report)
  status        "running"

说明:
  - 单 Agent 一步完成的任务用这个,create 即派发,不用手动 start
  - 内部等价于:task.create + task.step.add(assignee) + task.start,但一步原子完成
  - 创建后 status=running,默认 step 已派给 assignee
  - Agent 调 task.step.report(defaultStepId, done) 后任务 completed
  - ⚠️ 如果任务需要多步骤/多 Agent 协作,用 task.create,不要用这个
```

#### `task.get`
取任务全貌(步骤只返回标题+状态,不展开报告)。
```
参数:
  taskId        string    必填

返回:
  id            string
  title         string
  description   string          任务目标文档
  status        "draft"|"running"|"completed"
  steps: [
    {
      id            string
      title         string
      status        "pending"|"ready"|"running"|"done"|"blocked"
      assignee?     string        Agent ID
      dependsOn     string[]      依赖的 stepId 数组
    }
  ]
  assignedAgents  string[]       从 steps 聚合,涉及哪些 Agent

说明:
  - 看"任务到哪了"用这个,步骤只给标题+状态,token 可控
  - 要看某步骤的完整报告/产出,用 task.step.get
```

#### `task.update`
修改任务标题或目标文档。
```
参数:
  taskId        string    必填
  title?        string    可选
  description?  string    可选  任务目标文档

说明:
  - 不会触发回 draft(只改任务级字段,不动 steps)
  - 目标文档改了,Agent 下次 task.get 拿到新文档
```

#### `task.start`
启动任务,系统开始派发 ready 的 step。
```
参数:
  taskId        string    必填

说明:
  - draft → running,开始派发
  - running → running,幂等,重新评估全图(不是错误)
  - completed → 报错(已完成不能重启)
  - 系统扫描所有 step,按当前 dependsOn 重新算状态,该派的派
  - 已 running 的 step 不重派(避免重复派)
  - 任务在 draft 状态时不会派发任何步骤。运行中如果编辑了步骤,任务会自动回退到 draft,需要再次调用此工具恢复执行。
```

#### `task.step.get`
取单个步骤的完整详情 + 历史汇报。
```
参数:
  taskId        string    必填
  stepId        string    必填

返回:
  id            string
  title         string
  description   string
  status        string
  assignee?     string
  sessionId?    string
  dependsOn     string[]
  currentStage  string          当前进度(最近一次 updateProgress)
  reports: [                    历史汇报,按时间正序
    {
      agentStatus   "milestone"|"blocked"|"done"
      reportMd      string
      artifacts?    Artifact[]
      agentId       string
      sessionId     string
      time          string
    }
  ]

说明:
  - 要看步骤详情、历史汇报、产出时用
  - 下游 Agent 需要上游产出详情时调这个
```

---

### 4.2 步骤管理

#### `task.step.add`
给任务添加步骤。
```
参数:
  taskId        string    必填
  title         string    必填  步骤标题
  description   string    必填  做什么
  assignee?     string    可选  分派给哪个 Agent(不传 = 待认领)
  sessionId?    string    可选  指定会话(不传系统按 assignee 找/建)
  dependsOn?    string[]  可选  前置 stepId 数组(不传 = 无依赖,ready)

返回:
  stepId        string

说明:
  - ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
  - 完成所有步骤编辑后,必须调用 task.start 重新启动任务。
  - dependsOn 里的 stepId 必须存在,不存在报错。
  - 系统检测循环依赖,有循环拒绝创建。
```

#### `task.step.update`
修改步骤(标题/描述/依赖/分派)。
```
参数:
  taskId        string    必填
  stepId        string    必填
  title?        string    可选
  description?  string    可选
  dependsOn?    string[]  可选  传新数组,整体替换
  assignee?     string    可选
  sessionId?    string    可选

说明:
  - ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
  - 批量改多个步骤后,调用 task.start 重新启动。
  - dependsOn 整体替换,不是追加。要加依赖先 get 当前依赖再合并。
  - 已 running 的 step 改了 assignee,不强行收回,下次轮次按新 assignee。
  - 系统检测循环依赖,有循环拒绝修改。
```

#### `task.step.remove`
删除步骤。
```
参数:
  taskId        string    必填
  stepId        string    必填

说明:
  - ⚠️ 调用此工具会使任务回退到 draft 状态,系统暂停派发。
  - 改完调用 task.start 重新启动。
  - 任意状态都可删。
  - 删除时系统自动清理下游依赖(下游 dependsOn 里去掉这个 id)。
  - 下游如果没其他依赖 → 下次 start 时变 ready。
  - 删 done 步骤,其 artifacts 保留在历史汇报里,task.step.get 仍可查(标记"已删除步骤")。
  - 删 running 步骤,向对应会话发"步骤已取消"通知,不强停当前轮次。
```

---

### 4.3 步骤汇报

#### `task.step.updateProgress`
更新步骤进度(一句话,展示用)。
```
参数:
  taskId        string    必填
  stepId        string    必填
  stage         string    必填  一句话描述当前阶段,如"正在写数据库层"

说明:
  - 轻量进度更新,不带产出,不标记节点,纯展示。
  - 不改变 step 状态(step 还是 running)。
  - 用于让 PM/用户看到"做到哪了"。
  - 和 report(milestone) 的区别:milestone 有产出有报告,是关键节点;updateProgress 是一句话。
```

#### `task.step.report`
步骤汇报(关键节点/卡住/完成)。
```
参数:
  taskId        string    必填
  stepId        string    必填
  agentStatus   string    必填  "milestone"|"blocked"|"done"
  reportMd      string    必填  报告内容(Markdown)
  artifacts?    Artifact[] 可选  产出

返回:
  newStatus     string          step 新状态
  unlockedSteps string[]        本次解锁的下游 stepId(如适用)

说明:
  - milestone:过程标记,step 保持 running,继续做。一个 step 可多次 milestone。
  - blocked:卡住,等人工决策。PM 介入后可继续。
  - done:完成,解锁下游。系统自动检查下游,ready 的在 running 状态下会派发。
  - ⚠️ 没有 rejected。审查不通过 = 审查 step done(产出"不通过报告") + 新增修复 step + 新增重审 step + 更新下游依赖。
  - 记录 agentId、sessionId、时间,可溯源。
  - 任务在 draft 状态时 report 不解锁下游(但记录汇报),需 task.start 后才派发。

Artifact 结构:
  { type: "commit"|"file"|"doc"|"url", value: string }
```

---

## 五、Artifact 结构

```
Artifact = {
  type:   "commit" | "file" | "doc" | "url"
  value:  string
}
```

| type | value 示例 |
|---|---|
| commit | "abc1234" |
| file | "src/auth.ts" |
| doc | "docs/design.md" |
| url | "http://..." |

---

## 六、系统调度规则(task.start 及运行时)

### 派发逻辑(running 状态下)
1. 扫描所有 step,找 status=pending 且 dependsOn 全 done 的 → 变 ready
2. ready 且有 assignee → 系统派发(见 6.1 派发机制)
3. ready 无 assignee → 停着,等 PM 指派
4. 已 running 的不重派

### 6.1 派发机制(复用现有 enqueuePrompt,不新开通道)

**复用现有派发管道**:`taskManager.createTask` 的派发路径是 `buildTaskPrompt → sessionManager.enqueuePrompt`(纯内存排队,串行化,失败处理齐全)。step 派发完全同构,不新开 MCP 通道。

**新增 `taskManager.dispatchStep(taskId, stepId)` 方法**,内部三步:
1. `resolveStepSession(step)` —— 按 step.assignee 找会话(优先 step.sessionId → assignee 的 primary 会话 → 新建)
2. `buildStepPrompt(taskId, stepId)` —— 拼 step 级 prompt(见 6.2)
3. `sessionManager.enqueuePrompt(session.id, prompt)` —— 注入目标会话

**派发失败处理**:复用现有 `prompt_failed → needs_input` 逻辑(`src/core/tasks.ts:91`)。step 派发失败时,step 保持 ready,任务级设 `needs_input`,PM 在"待确认"tab 看到。

### 6.2 派发 prompt 模板(`buildStepPrompt`)

新增 `buildStepPrompt(taskId, stepId)` 函数,风格对齐现有 `buildTaskPrompt`(`src/core/tasks.ts:374-451`)。内容(对齐第八章防失忆 4 项):

```
你是被步骤派发唤醒的 Agent。

【任务】#{taskId} {taskTitle}
{task.description 全文}

【步骤图当前状态】
1. {step1Title} [{step1Status}]
2. {step2Title} [{step2Status}]  ← 你在这里
3. {step3Title} [{step3Status}]

【你的步骤】#{stepId} {stepTitle}
{step.description}
当前进度:{step.currentStage 或 "尚未开始"}

【上游产出摘要】
- 上游步骤 #{upstreamStepId} {upstreamTitle}: {最近 report 的 reportMd 前 200 字}
  artifacts: {upstream.artifacts 列表}
(可调 task.step.get(taskId, stepId) 拉完整报告)

【可用工具】
- task.step.updateProgress(taskId, stepId, stage) —— 更新一句话进度
- task.step.report(taskId, stepId, agentStatus, reportMd, artifacts?) —— 汇报(milestone/blocked/done)
- task.get(taskId) —— 看任务全貌
- task.step.get(taskId, stepId) —— 看任意步骤详情(含上游产出)

【执行要求】
1. 每次调用工具必须带 taskId 和 stepId
2. 关键节点用 report(milestone),完成用 report(done),卡住用 report(blocked)
3. report 的 reportMd 要写完整:做了什么/改动详情/验证结果/下一步
4. 任务在 draft 状态时 report 不解锁下游,需 PM task.start 后才继续
```

### report(done) 触发
- step 变 done
- 重新扫描下游,解锁 ready 的
- running 状态下立即派发(调 dispatchStep);draft 状态下只标记不派

### 任务整体状态(系统自动算)
- 所有 step done → completed
- 有 step running → running
- 全 pending → draft(未 start)
- 有 step blocked → 任务级 needs_input(见第十章 10.1)

### 回退到 draft 的机制
任何 `step.add/update/remove` 触发任务自动回 draft:
- 记录 `task_reverted` 事件(payload 含 triggerStepId + triggerAction)
- 已 running 的 step 继续跑完(不强停),但其 report 不解锁下游
- 调 `task.start` 重新评估全图,按当前 dependsOn 该派的派

---

## 七、完整场景示例

### 场景 1:一次性编排(产品→开发→测试→验收)

```
# 编排阶段(draft)
t = task.create("实现登录重构", "需求文档...")

s1 = task.step.add(t, "方案设计", "设计登录重构方案", assignee=PM)
s2 = task.step.add(t, "后端开发", "实现后端接口", assignee=devA, dependsOn=[s1])
s3 = task.step.add(t, "前端开发", "实现前端页面", assignee=devB, dependsOn=[s1])
s4 = task.step.add(t, "测试", "集成测试", assignee=tester, dependsOn=[s2, s3])
s5 = task.step.add(t, "验收", "PM验收", assignee=PM, dependsOn=[s4])

# 启动
task.start(t)
# → s1 ready → 派给 PM

# PM 做完设计
task.step.report(t, s1, done, "设计完成", artifacts=[{type:"doc", value:"设计文档.md"}])
# → s2, s3 ready → 并行派给 devA, devB

# devA 后端 done
task.step.report(t, s2, done, "后端完成", artifacts=[{type:"commit", value:"abc123"}])
# devB 还在跑,s4 要等 s2+s3,不 ready

# devB 前端 done
task.step.report(t, s3, done, "前端完成", artifacts=[{type:"commit", value:"def456"}])
# → s4 ready → 派给 tester

# 测试发现 bug
task.step.report(t, s4, done, "测试完成,发现登录bug", artifacts=[{type:"doc", value:"bug报告.md"}])
# ⚠️ s5 不会 ready(因为有 bug,PM 要改依赖)

# PM 介入插队(自动回 draft)
s6 = task.step.add(t, "缺陷修复", "修登录bug", assignee=devA, dependsOn=[s4])
s7 = task.step.add(t, "回归测试", "重新测试", assignee=tester, dependsOn=[s6])
task.step.update(t, s5, dependsOn=[s7])  # 验收改成依赖回归测试
task.start(t)
# → 重新评估:s4 已 done,s6 ready → 派给 devA

# 修复 done → 回归测试 ready
task.step.report(t, s6, done, "修复完成", artifacts=[{type:"commit", value:"ghi789"}])
# → s7 ready → 派给 tester

# 回归测试 done → 验收 ready
task.step.report(t, s7, done, "回归测试通过")
# → s5 ready → 派给 PM

# 验收 done → 任务 completed
task.step.report(t, s5, done, "验收通过")
# → 所有 step done → 任务 completed
```

### 场景 2:简单任务(一步创建)

```
t = task.createSimple("修个typo", "README 里 ai-ide-studio 拼错", assignee="coder-prd")
# → 自动建默认 step + 自动 start,默认 step 已派给 coder-prd
# → 返回 taskId + defaultStepId

# coder-prd 做完
task.step.report(t, defaultStepId, done, "已修复", artifacts=[{type:"commit", value:"fix123"}])
# → 任务 completed
```

### 场景 2.5:对话任务化(selfExecute)

```
# 用户在当前对话说"帮我修 README 的 typo"
t = task.create("修 README typo", "ai-ide-studio 拼错", selfExecute=true)
# → 建默认 step(assignee=自己),跳过 prompt 注入,任务直接 running
# → 返回 taskId + defaultStepId

# Agent 直接修(用户消息就是上下文,不需要再注入 prompt)
# 修完
task.step.report(t, defaultStepId, done, "已修复", artifacts=[{type:"commit", value:"fix123"}])
# → 任务 completed
```

### 场景 3:动态追加(运行中发现要加安全审查)

```
# 运行中:step1(done)→step2(开发,running)→step3(测试,pending)

# PM 决定加安全审查
s4 = task.step.add(t, "安全审查", "审查安全性", assignee=sec, dependsOn=[step2])
# → 自动回 draft,step2 继续跑,但不解锁下游

s5 = task.step.add(t, "安全修复", "修安全问题", assignee=devA, dependsOn=[s4])
task.step.update(t, step3, dependsOn=[step2, s5])  # 测试要等安全修复

task.start(t)
# → 重新评估:step2 还 running,s4 等 step2,s5 等 s4,都不派
# step2 done 后 → s4 ready → 派给 sec
```

---

## 八、防失忆:Agent 被唤醒的上下文

Agent 被 step 派发唤醒时,系统注入的 prompt 应包含:

1. **任务目标文档**(task.description 全文)
2. **当前步骤图快照**(从 task.get 取,步骤只标题+状态)
3. **我的步骤详情**(task.step.get,含 description + 上次汇报)
4. **直接上游步骤的产出摘要**(可调 task.step.get 拉详情)

这样 Agent 即使会话拐了多个弯,拿到的永远是"图当前状态 + 我的任务 + 上游产出",不会失忆。

---

## 九、和现有系统的兼容

| 现有 | 新模型 |
|---|---|
| `studio.task.create` | 保留;去掉 assignee/sessionMode/sessionId/executionModeId 参数;新增 selfExecute(对话任务化模式,设计补上);简单任务用 `studio.task.createSimple` |
| `studio.task.createSimple` | 新增,简单任务一步创建 + 自动 start |
| `studio.task.report` | 扩展,加可选 `stepId` 参数;不传走老逻辑(老任务) |
| `studio.task.get` | 返回值加 `steps` 数组(老任务为空) |
| `assigned_agent_id` | 保留,简单任务用;协作任务用 step.assignee |
| `task_events` | 保留,step 的 report 也 append,带 stepId |
| `buildTaskPrompt` | 保留;新增 `buildStepPrompt` 兄弟函数 |
| `enqueuePrompt` | 复用,step 派发走同一管道 |
| `needs_input` | 语义不变,新增"step blocked"触发源 |

**兼容路线**:老任务零改动(无 steps,走老逻辑),新任务才用步骤图。

---

## 十、数据库设计

### 10.1 现有表改动

#### tasks 表
status 枚举语义对齐:
| 旧值 | 新值 | 含义 |
|---|---|---|
| backlog | draft | 草稿,未 start |
| executing | running | 运行中 |
| needs_input | needs_input | 保留(有 step blocked 或派发失败时) |
| completed | completed | 完成 |
| cancelled | cancelled | 取消 |

migration:更新现有数据 status 值(backlog→draft, executing→running)。其余字段不变。

#### needs_input 与 step blocked 的映射(保留 needs_input)
- 任意 step `report(blocked)` → 任务级 `needs_input`(PM 在"待确认"tab 看到)
- 该 step 后续 `report(milestone)` 恢复 running → 任务级回 `running`(复用现有 `src/core/tasks.ts:219` 逻辑)
- step 派发失败(prompt_failed/assign_failed)→ 任务级 `needs_input`(复用现有 `src/core/tasks.ts:91/106` 逻辑)
- 老任务的 needs_input 逻辑完全不变

#### step 删除的会话处理(不加 cancelled 状态,软通知)
- `step.remove` 删 running step 时,向对应会话 `enqueuePrompt` 一条"步骤 #{stepId} 已取消,停止当前工作"
- 不强停会话(会话可能在跑其他 step,或当前轮次已发出无法收回)
- step 从 DB 软删(或物理删,artifacts 保留在 task_events 历史)
- 和现有 `tasks.delete 不 close session`(`src/gateway/rpc/tasks.ts:88-95`)对齐
- 代价:可能有"幽灵工作"(step 删了但会话还在跑当前轮次),但下一轮派发不会再来,会话闲了自然停

### 10.2 新增表

#### task_steps(步骤表)
```sql
CREATE TABLE task_steps (
  id                  TEXT PRIMARY KEY,
  task_id             TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
    -- pending / ready / running / done / blocked
  assignee_agent_id   TEXT,
  session_id          TEXT,
  current_stage       TEXT,           -- 最新 updateProgress 的一句话
  sort_order          INTEGER NOT NULL DEFAULT 0,  -- 创建序
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (assignee_agent_id) REFERENCES agents(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_task_steps_task_id ON task_steps(task_id);
CREATE INDEX idx_task_steps_status ON task_steps(status);
CREATE INDEX idx_task_steps_assignee ON task_steps(assignee_agent_id);
```

#### task_step_dependencies(依赖关系表)
```sql
CREATE TABLE task_step_dependencies (
  step_id             TEXT NOT NULL,        -- 当前步骤
  depends_on_step_id  TEXT NOT NULL,        -- 依赖的上游步骤
  task_id             TEXT NOT NULL,        -- 冗余,方便按任务查
  created_at          TEXT NOT NULL,
  PRIMARY KEY (step_id, depends_on_step_id),
  FOREIGN KEY (step_id) REFERENCES task_steps(id) ON DELETE CASCADE,
  FOREIGN KEY (depends_on_step_id) REFERENCES task_steps(id) ON DELETE CASCADE
);

CREATE INDEX idx_step_deps_step ON task_step_dependencies(step_id);
CREATE INDEX idx_step_deps_depends_on ON task_step_dependencies(depends_on_step_id);
CREATE INDEX idx_step_deps_task ON task_step_dependencies(task_id);
```

**为什么用单独表而不是 JSON 数组**:
- 删 step 时 CASCADE 自动清理下游依赖
- 查反向依赖(谁依赖我)高效
- 循环依赖检测方便(递归查询)
- 工具层返回时聚合成 `step.dependsOn` 数组,对 AI 透明

### 10.3 task_events 表扩展(不改结构)

现有 task_events 表保留,step 相关事件也 append:

**新增 type 值**:
| type | 触发时机 | payload 关键字段 |
|---|---|---|
| step_added | step.add | stepId, title, assignee, dependsOn |
| step_updated | step.update | stepId, changes(title/desc/dependsOn/assignee) |
| step_removed | step.remove | stepId |
| step_progress | updateProgress | stepId, stage |
| step_report | step.report | stepId, agentStatus, reportMd, artifacts, agentId, sessionId |
| task_started | task.start | previousStatus |
| task_reverted | 编辑触发回 draft | triggerStepId, triggerAction |

**payload_json 里统一加 `stepId` 字段**(step 相关事件)。

### 10.4 artifacts 存储

artifacts 存在 `task_events.payload_json` 里(step_report 事件),不单独建表。
```json
{
  "stepId": "step-xxx",
  "agentStatus": "done",
  "reportMd": "...",
  "artifacts": [
    {"type": "commit", "value": "abc123"},
    {"type": "file", "value": "src/auth.ts"}
  ],
  "agentId": "agent-xxx",
  "sessionId": "sess-xxx"
}
```

### 10.5 查询模式

| 查询 | SQL |
|---|---|
| 任务的步骤图 | `SELECT * FROM task_steps WHERE task_id=? ORDER BY sort_order` |
| 步骤的依赖 | `SELECT depends_on_step_id FROM task_step_dependencies WHERE step_id=?` |
| 谁依赖某步骤 | `SELECT step_id FROM task_step_dependencies WHERE depends_on_step_id=?` |
| 步骤的历史汇报 | `SELECT * FROM task_events WHERE task_id=? AND type='step_report' AND json_extract(payload_json,'$.stepId')=? ORDER BY sequence` |
| 任务涉及的 Agent | `SELECT DISTINCT assignee_agent_id FROM task_steps WHERE task_id=? AND assignee_agent_id IS NOT NULL` |
| ready 的步骤(派发用) | `SELECT s.* FROM task_steps s WHERE s.task_id=? AND s.status='pending' AND NOT EXISTS(SELECT 1 FROM task_step_dependencies d WHERE d.step_id=s.id AND NOT EXISTS(SELECT 1 FROM task_steps s2 WHERE s2.id=d.depends_on_step_id AND s2.status='done'))` |

### 10.6 migration 清单

新增 migration `0xx-task-steps.ts`:
1. tasks 表 status 值迁移(backlog→draft, executing→running)
2. 建 task_steps 表
3. 建 task_step_dependencies 表
4. 同步更新 `tests/integration/sqlite-migration.test.ts`

---

## 十一、已定决策(原待定问题)

1. **工具命名前缀**:`studio.task.*`,和现有保持一致。
2. **step 状态不加 cancelled**:删 running step 用软通知(向会话发"步骤已取消"),不强停。step 状态只有 pending/ready/running/done/blocked。
3. **任务级 needs_input 保留**:任意 step blocked → 任务 needs_input;step 恢复 → 任务回 running。复用现有逻辑。
4. **里程碑 report 触发通知**:milestone 时向 PM 会话发轻量通知(复用 `agent_message_send` 或事件),让 PM 感知关键节点达成。具体通知通道由开发实现时定(优先复用现有事件机制)。
