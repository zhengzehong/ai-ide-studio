# 任务管理系统 — 功能设计文档

> 版本：v2.0 | 日期：2026-06-02 | 状态：设计中

---

## 一、功能概述

任务是 AI IDE Studio 中**人与 Agent 协作的基本单元**。用户创建任务、指派给 Agent 执行，Agent 也能自主创建任务或被定时规则触发。任务贯穿从创建到完成的完整生命周期，串联对话（Session）、Agent、项目三者关系。

### 核心能力

| 能力 | 说明 |
|------|------|
| **多来源创建** | 用户手动创建、Agent 工具创建、定时规则自动创建 |
| **Agent 驱动状态** | Agent 通过工具主动汇报进度、请求输入、标记完成，**不是对话结束就自动完成** |
| **双向协作** | Agent 执行中可以上报阻塞、请求人工确认，人也可以随时干预 |
| **看板 + 对话联动** | 任务看板全局查看，对话右侧实时关联 |
| **项目隔离** | 任务归属项目，不同项目互不干扰 |

### 业务场景

1. **标准执行** — 用户创建"重构登录模块"，Agent 执行过程中更新进度，完成后标记为审查中，用户确认后完成
2. **中途请求确认** — Agent 在执行中发现有两种方案，调用工具请求用户选择，用户回复后继续
3. **上报阻塞** — Agent 发现缺少权限/依赖，调用工具标记阻塞并说明原因，用户看到后处理
4. **Agent 自主创建** — 架构师 Agent 审查时发现问题，主动创建子任务
5. **定时触发** — 每天 9 点自动创建审查任务，Agent 执行完毕后主动汇报结果

---

## 二、完整业务闭环

### 2.1 闭环一：用户创建任务 → Agent 执行 → Agent 汇报 → 人工确认

```
用户在「任务看板」或「对话右侧面板」点击「新建任务」
  → 填写：任务标题、描述（可选）、指派 Agent（可选）、选择会话（可选）
  → 创建成功，任务出现在看板「待办」列

如果指派了 Agent：
  → 如果选了已有会话：复用该会话，在该对话中发送任务 prompt
  → 如果没选会话：系统自动新建会话，关联到这个任务
  → 系统发送「任务指派 prompt」（明确告知这是任务触发的对话 + 任务信息 + 工具使用说明）
  → 任务状态变为「执行中」

Agent 收到任务指派 prompt 后开始工作：
  → Agent 调用 studio.task.update_progress 汇报阶段进展
     例如："正在分析代码结构" → "正在编写重构方案" → "正在修改文件"
  → 看板卡片实时更新阶段描述

Agent 认为完成了：
  → Agent 调用 studio.task.mark_done 标记任务为「审查中」
  → 用户在看板看到任务进入「审查中」
  → 用户审查后标记「已完成」或打回继续

注意：如果 Agent 对话结束（session:done）但没有调用 mark_done，
任务状态**不会自动变化**，仍然停留在「执行中」
```

### 2.2 闭环二：Agent 执行中请求人工输入

```
Agent 在执行任务过程中遇到需要人工决策的问题
  → Agent 调用 studio.task.request_input
     参数：question="发现两种方案：A 用 JWT，B 用 Session，请选择"
  → 任务状态变为「待确认」
  → 看板卡片高亮显示，阶段描述显示 Agent 的问题
  → 用户在看板或对话右侧面板看到这个任务需要处理

用户处理：
  → 方式 1：在对话中直接回复 Agent，然后 Agent 继续工作并调用
             studio.task.update_progress 将状态推回「执行中」
  → 方式 2：在看板中手动修改任务状态为「执行中」+ 更新描述
```

### 2.3 闭环三：Agent 上报阻塞

```
Agent 在执行任务过程中遇到自己无法解决的问题
  → Agent 调用 studio.task.mark_blocked
     参数：reason="缺少数据库访问权限，无法执行迁移"
  → 任务状态变为「已阻塞」
  → 看板卡片显示阻塞原因

用户处理完阻塞原因后：
  → 在对话中告诉 Agent 继续
  → Agent 继续工作，调用 studio.task.update_progress 推回「执行中」
```

### 2.4 闭环四：Agent 主动创建任务

```
用户在对话中说："帮我检查一下这个项目有没有安全问题"

Agent 在执行过程中发现多个问题
  → 调用 studio.task.create："修复 SQL 注入漏洞"
  → 调用 studio.task.create："更新过期的依赖"
  → Agent 回复用户："发现 2 个问题，已创建对应任务"
  → 用户在任务看板看到这 2 个新任务（来源标记为「Agent」）
```

### 2.5 闭环五：对话中查看和管理任务

```
用户在工作区（Workspace）进行对话
  → 对话右侧面板显示当前项目的任务列表
  → 可按 tab 筛选：全部 / 待办 / 进行中 / 需处理 / 已完成
  → "需处理" tab 聚合了 blocked + needs_input 状态的任务
  → 点击任务卡片 → 跳转到该任务关联的对话
  → 也可以直接在右侧面板新建任务
```

---

## 三、功能清单

### 3.1 任务 CRUD

| 功能 | 操作者 | 说明 |
|------|--------|------|
| 创建任务 | 用户 / Agent / 定时规则 | 标题必填，可选描述、指派 Agent |
| 查看任务列表 | 用户 / Agent | 按项目过滤，支持按状态筛选 |
| 查看任务详情 | 用户 / Agent | 标题、描述、状态、阶段、Agent、对话、时间线 |
| 更新任务 | 用户 / Agent | 修改标题、描述、状态、阶段 |
| 删除任务 | 用户 | 删除后不可恢复 |

### 3.2 任务指派

| 功能 | 说明 |
|------|------|
| 创建时指派 | 选择 Agent + 可选会话，发送任务指派 prompt |
| 后续指派 | 未指派的任务，后续可指派 Agent |
| 重新指派 | 已指派的任务，可更换 Agent（默认新建会话） |

**会话选择逻辑**：
- 指派时可选择已有会话或不选（新建）
- 选择已有会话：在该对话上下文中追加任务指派 prompt，Agent 可以利用已有上下文
- 不选会话（默认）：系统新建一个会话，专门用于这个任务
- 复用会话的典型场景：用户和 Agent 已经讨论了方案，现在把它变成正式任务追踪

### 3.3 状态管理

| 状态 | 中文名 | 含义 | 谁触发 |
|------|--------|------|--------|
| `backlog` | 待办 | 已创建，等待处理 | 创建时默认 |
| `executing` | 执行中 | Agent 正在工作 | 系统（指派后）/ Agent（恢复执行） |
| `needs_input` | 待确认 | Agent 需要人工输入才能继续 | **Agent 主动** |
| `blocked` | 已阻塞 | 遇到 Agent 无法解决的问题 | **Agent 主动** / 人工 |
| `reviewing` | 审查中 | Agent 认为任务完成，等待人工确认 | **Agent 主动** |
| `completed` | 已完成 | 终态 | 人工确认 |
| `cancelled` | 已取消 | 终态 | 人工操作 |

**关键原则：Agent 通过工具主动驱动状态变更，系统不因 session:done 自动改变任务状态。**

### 3.4 任务来源

| 来源 | 标识 | 说明 |
|------|------|------|
| 用户手动 | `human` | 用户在 UI 创建 |
| Agent 创建 | `agent` | Agent 通过工具创建 |
| 定时规则 | `schedule` | 定时规则自动触发创建 |

### 3.5 任务与对话的关系

| 场景 | 行为 |
|------|------|
| 创建任务 + 指派 Agent（不选会话） | 新建对话，关联到任务 |
| 创建任务 + 指派 Agent（选已有会话） | 复用会话，在该对话中追加任务指派 prompt |
| 重新指派 Agent | 默认新建对话，也可选已有会话 |
| 点击任务 | 可跳转到关联对话 |
| 一个任务可关联多个对话 | 重新指派、多轮对话等场景 |

### 3.6 Agent 工具

Agent 通过以下工具管理任务（详细参数见第六章）：

| 工具名 | 功能 | 场景 |
|--------|------|------|
| `studio.task.create` | 创建任务 | Agent 发现新问题/需求 |
| `studio.task.list` | 查看任务列表 | Agent 了解当前项目任务情况 |
| `studio.task.get` | 查看单个任务详情 | Agent 获取任务完整信息 |
| `studio.task.update_progress` | 更新执行进度 | Agent 汇报当前在做什么 |
| `studio.task.request_input` | 请求人工输入 | Agent 遇到需要人工决策的分支 |
| `studio.task.mark_blocked` | 标记阻塞 | Agent 遇到自己无法解决的问题 |
| `studio.task.mark_done` | 标记完成待审查 | Agent 认为任务做完了 |

---

## 四、工具命名与注入策略

### 4.1 问题：如何与 Agent Runtime 自带的 tasks 区分

Claude Code 和 Codex 等 Agent Runtime 自身也有 task/todo 概念（如 Codex 的 `--task` 参数，Claude Code 的内部任务追踪）。我们的任务工具是**项目级的任务管理**，与 Agent Runtime 内部的概念完全不同，需要让 Agent 清楚区分。

### 4.2 命名策略

**使用 `studio.task.*` 命名空间**，而非 `task.*` 或 `core.task.*`：
- `studio` 前缀明确标识这是 AI IDE Studio 平台提供的工具
- 与 Agent Runtime 自带的概念不会混淆
- 所有平台级工具统一用 `studio.*` 前缀（`studio.task.*`、`studio.schedule.*` 等）

### 4.3 工具描述注入

每个工具的 `description` 字段必须包含上下文说明，让 Agent 理解这是平台工具：

> 示例：`studio.task.mark_done` 的 description：
> "将 AI IDE Studio 项目任务标记为完成待审查。这是平台级任务管理，不是你的内部 task。当你认为当前分派给你的任务已经完成时，调用此工具通知平台和用户。"

### 4.4 任务指派 prompt

当任务指派给 Agent 时，系统自动发送一条**任务指派 prompt**。这条 prompt 有三个目的：
1. 告诉 Agent 这是一个**由任务系统触发的对话**，不是用户随意闲聊
2. 提供任务的完整上下文（标题、描述、ID）
3. 明确说明如何使用平台工具来管理任务状态和反馈

**完整 prompt 模板**：

```
[系统提示] 这是一条由 AI IDE Studio 任务系统触发的对话。
你被分派了一个项目任务，请按照以下信息执行。

━━━ 任务信息 ━━━
任务 ID：{taskId}
任务标题：{title}
任务描述：{description}
来源：{source}（human=用户创建 / schedule=定时触发 / agent=其他Agent创建）

━━━ 任务管理工具 ━━━
本次对话中你可以使用以下 AI IDE Studio 平台工具来管理任务进度。
注意：这些是平台级的项目任务管理工具，不是你自身的内部 task/todo，请区分使用。

1. studio.task.update_progress(taskId, stage)
   - 用途：汇报当前工作进度
   - 时机：每完成一个阶段、开始新的步骤时调用
   - 示例：studio.task.update_progress("{taskId}", "正在分析代码结构")
   - 特殊：如果任务处于「待确认」或「已阻塞」状态，调用此工具会自动恢复为「执行中」

2. studio.task.request_input(taskId, question)
   - 用途：遇到需要用户决策的问题时，暂停并请求输入
   - 时机：有多个方案需要选择、需要确认方向、缺少关键信息时
   - 效果：任务状态变为「待确认」，用户会在任务面板中看到你的问题
   - 示例：studio.task.request_input("{taskId}", "发现两种方案：A=JWT B=Session，请选择")

3. studio.task.mark_blocked(taskId, reason)
   - 用途：遇到自己无法解决的障碍时上报
   - 时机：缺少权限、依赖未安装、需要外部操作等
   - 效果：任务状态变为「已阻塞」，用户会看到阻塞原因
   - 示例：studio.task.mark_blocked("{taskId}", "缺少数据库写入权限，请授权后告知")

4. studio.task.mark_done(taskId, summary)
   - 用途：任务全部完成后，通知用户审查
   - 时机：所有工作完成、确认无误后调用（只调用一次）
   - 效果：任务状态变为「审查中」，等待用户确认
   - 示例：studio.task.mark_done("{taskId}", "已完成登录模块重构，改为 JWT 方案，涉及 5 个文件")

━━━ 执行要求 ━━━
1. 开始工作前，先调用 studio.task.update_progress 标记 "开始执行"
2. 执行过程中，每完成一个关键步骤都调用 studio.task.update_progress 更新进度
3. 遇到不确定的决策点，调用 studio.task.request_input 请求用户输入，不要自行猜测
4. 遇到无法解决的问题，调用 studio.task.mark_blocked 上报，不要跳过或忽略
5. 全部完成后，调用 studio.task.mark_done 并附上工作总结
6. 不要在没有调用 mark_done 的情况下就结束对话

请现在开始执行任务。
```

**补充说明**：
- `{taskId}`、`{title}`、`{description}`、`{source}` 由系统自动填充
- 如果任务是复用已有会话，prompt 前会加一行：`[接续上下文] 以下是一个新的任务指派，请在当前对话上下文基础上执行。`
- 如果任务由定时规则触发，`{source}` 为 `schedule`，prompt 中会额外标注规则名称

### 4.5 默认绑定

`studio.task.*` 系列工具为 `builtin` 类型，`defaultScope: 'global'`，**所有 Agent 默认可用**。Agent 无需任何配置即可使用任务管理工具。

---

## 五、任务数据结构

### 5.1 一条任务包含的信息

| 字段 | 说明 | 示例 |
|------|------|------|
| 任务 ID | 唯一标识 | `task-a1b2c3d4` |
| 标题 | 必填 | "重构登录模块" |
| 描述 | 可选 | "将 cookie 方式改为 JWT" |
| 来源 | 谁创建的 | `human` / `agent` / `schedule` |
| 状态 | 当前状态 | `backlog` / `executing` / `needs_input` / ... |
| 阶段描述 | 人可读的当前阶段说明 | "正在分析代码结构" |
| 阻塞/确认原因 | blocked 或 needs_input 时的说明 | "缺少数据库权限" |
| 指派 Agent | 负责执行的 Agent | `agent-xxx` 或空 |
| 所属项目 | **必填** | `proj-xxx` |
| 来源规则 | 定时规则创建时追溯 | `rule-xxx` 或空 |
| 创建时间 | | ISO 时间 |
| 完成时间 | 终态时写入 | ISO 时间 或空 |

### 5.2 任务状态流转图

```
                                        ┌──── Agent: request_input ────┐
                                        │                              ▼
┌──────────┐  指派Agent  ┌────────────┐ │   ┌──────────────┐    用户回复/Agent恢复
│ backlog  │ ──────────→ │ executing  │─┘   │ needs_input  │ ─────────┐
│  待办    │             │  执行中     │◄────│  待确认       │          │
└──────────┘             └────────────┘     └──────────────┘          │
     │                     │       │                                   │
     │                     │       │   Agent: mark_done               │
     │                     │       └────────────────┐                  │
     │                     │                        ▼                  │
     │                     │  Agent: mark_blocked  ┌────────────┐     │
     │                     └──────────────────────→│ reviewing  │     │
     │                     │                       │  审查中     │     │
     │                     ▼                       └─────┬──────┘     │
     │               ┌───────────┐                       │            │
     │               │  blocked  │    人工确认            │            │
     │               │  已阻塞   │◄── 用户也可设 ────────┘            │
     │               └───────────┘                       │            │
     │                     ▲                              ▼            │
     │                     └──── 用户也可设 ───── ┌────────────┐      │
     │                                           │ completed  │      │
     │  不需要了                                  │  已完成     │      │
     ▼                                           └────────────┘      │
┌───────────┐                                                         │
│ cancelled │◄────────── 用户也可从任意非终态取消 ─────────────────────┘
│  已取消    │
└───────────┘
```

**状态变更规则**：

| 变更 | 触发者 | 条件 |
|------|--------|------|
| `backlog` → `executing` | 系统 | 指派 Agent 后自动 |
| `executing` → `needs_input` | Agent | 调用 `request_input` |
| `executing` → `blocked` | Agent / 人工 | 调用 `mark_blocked` 或人工操作 |
| `executing` → `reviewing` | Agent | 调用 `mark_done` |
| `needs_input` → `executing` | Agent | 用户回复后 Agent 调用 `update_progress` 恢复 |
| `blocked` → `executing` | Agent / 人工 | 问题解决后恢复 |
| `reviewing` → `completed` | 人工 | 用户确认通过 |
| `reviewing` → `executing` | 人工 | 用户打回，让 Agent 继续改 |
| 任意非终态 → `cancelled` | 人工 | 用户取消 |
| 任意非终态 → `completed` | 人工 | 用户直接标记完成 |

---

## 六、UI 交互说明

### 6.1 任务看板页（/tasks）

**入口**：左侧导航栏「任务看板」

**页面结构**：看板（Kanban）布局，按状态分为 4 列

| 列 | 包含的状态 | 说明 |
|----|-----------|------|
| 待办 | `backlog` | 等待处理的任务 |
| 进行中 | `executing`、`needs_input` | Agent 在工作 或 等待输入 |
| 需处理 | `blocked`、`reviewing` | 需要人工介入（阻塞/审查） |
| 已完成 | `completed`、`cancelled` | 终态任务 |

**每张任务卡片显示**：

| 内容 | 说明 |
|------|------|
| 标题 | 任务名称 |
| 来源标签 | 手动 / Agent / 定时 |
| 状态标签 | 彩色 badge："执行中" / "待确认" / "审查中" / "已阻塞" |
| 阶段描述 | 当前阶段的人可读说明 |
| 指派 Agent | Agent 名称或"未指派" |
| 创建时间 | 相对时间 |
| 描述预览 | 最多 2 行 |

**特殊状态高亮**：
- `needs_input`：卡片带**黄色边框**，显示 Agent 的问题
- `blocked`：卡片带**红色边框**，显示阻塞原因
- `reviewing`：卡片带**蓝色边框**

**卡片操作**：
- 点击卡片 → 展开右侧详情抽屉
- 详情抽屉中可以：
  - 查看完整描述
  - 修改状态（下拉选择）
  - 指派 / 重新指派 Agent
  - 跳转到关联对话
  - 删除任务

**顶部操作**：
- 「新建任务」按钮
- 项目过滤（自动按当前选中项目过滤）

### 6.2 对话右侧任务面板

**位置**：工作区（Workspace）对话区域的右侧面板

**显示条件**：当前会话非 Team 模式时显示

**面板结构**：
- 顶部：标题「任务」+ 「新建」按钮
- Tab 栏（5 个）：

| Tab | 过滤条件 | 未读提示 |
|-----|---------|---------|
| 全部 | 所有任务 | |
| 待办 | `backlog` | |
| 进行中 | `executing`、`needs_input` | `needs_input` 数量 badge |
| 需处理 | `blocked`、`reviewing` | 总数 badge |
| 已完成 | `completed`、`cancelled` | |

**任务卡片**：简洁版（标题、状态 badge、Agent 名、阶段描述 1 行、创建时间）

**卡片交互**：
- 点击卡片 → 如果任务有关联对话，切换到该对话
- 点击卡片 → 如果任务无关联对话，展示任务详情弹窗

**数据范围**：仅显示当前项目的任务

### 6.3 新建任务弹窗

**触发位置**：任务看板「新建任务」 / 对话右侧面板「新建」 / 概览页

**字段**：

1. **任务标题**（必填，文本框）
2. **任务描述**（可选，多行文本框）
3. **指派 Agent**（可选，下拉选择当前项目的 Agent 列表）
4. **选择会话**（可选，选了 Agent 后出现，下拉选择该 Agent 的已有会话列表 + "新建会话" 选项）

> 选择已有会话时，下方提示："将在该对话中追加任务指派，Agent 可利用已有上下文"
> 选择新建会话（默认）时，下方提示："将为此任务创建新的对话"

**创建成功后**：
- 弹窗关闭
- 如果指派了 Agent：自动跳转到对应的对话（新建或已有）
- 如果没有指派：任务出现在看板待办列

### 6.4 任务详情抽屉

**触发**：任务看板中点击卡片

**内容**：

| 区域 | 内容 |
|------|------|
| 标题 | 可编辑 |
| 描述 | 可编辑 |
| 状态 | 下拉切换 |
| 阶段 | 只读（Agent 通过工具更新） |
| 阻塞/确认原因 | blocked 或 needs_input 时显示原因 |
| 指派 Agent | 下拉选择 / 可更换 |
| 来源 | 只读标签（手动 / Agent / 定时） |
| 来源规则 | 如果来源=定时，显示规则名（可点击跳转） |
| 关联对话 | 对话列表，可点击跳转 |
| 创建时间 | 只读 |
| 完成时间 | 只读（终态后显示） |
| 操作 | 删除按钮 |

---

## 七、Agent 工具详细参数

### 7.1 `studio.task.create` — 创建任务

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 任务标题 |
| `description` | string | | 任务描述 |
| `assignAgentId` | string | | 指派 Agent |
| `sessionId` | string | | 复用已有会话，不传则新建 |
| `projectId` | string | | 不传时用当前会话所属项目 |

**返回**：`{ taskId, title, status, sessionId? }`

工具描述：*"在 AI IDE Studio 项目中创建一个新任务。这是平台级任务管理，用于追踪需要完成的工作项。指派 Agent 后会自动发送任务指派消息。"*

### 7.2 `studio.task.list` — 查看任务列表

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `projectId` | string | | 不传用当前会话项目 |
| `status` | string | | 按状态过滤 |

**返回**：任务数组

工具描述：*"查看当前 AI IDE Studio 项目中的任务列表。可按状态过滤。"*

### 7.3 `studio.task.get` — 查看任务详情

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | |

**返回**：任务完整信息 + 关联对话列表

工具描述：*"获取 AI IDE Studio 项目中单个任务的完整详情。"*

### 7.4 `studio.task.update_progress` — 更新执行进度

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | |
| `stage` | string | ✅ | 当前阶段描述，如 "正在分析代码结构" |

**行为**：更新阶段描述。如果任务当前状态为 `needs_input` 或 `blocked`，自动恢复为 `executing`。

**返回**：`{ taskId, status, stage }`

工具描述：*"更新你当前正在执行的 AI IDE Studio 项目任务的进度。每完成一个阶段都应该调用此工具让用户了解进展。当从待确认或阻塞状态恢复时也用此工具。"*

### 7.5 `studio.task.request_input` — 请求人工输入

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | |
| `question` | string | ✅ | 需要人工确认的问题 |

**行为**：任务状态变为 `needs_input`，`stage` 更新为 question 内容。

**返回**：`{ taskId, status: 'needs_input' }`

工具描述：*"当你在执行 AI IDE Studio 项目任务时，遇到需要人工决策或确认的分支，调用此工具。用户会在任务面板中看到你的问题。"*

### 7.6 `studio.task.mark_blocked` — 标记阻塞

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | |
| `reason` | string | ✅ | 阻塞原因 |

**行为**：任务状态变为 `blocked`，`stage` 更新为 reason。

**返回**：`{ taskId, status: 'blocked' }`

工具描述：*"当你在执行 AI IDE Studio 项目任务时，遇到自己无法解决的问题（如缺少权限、缺少依赖、需要外部操作），调用此工具上报阻塞。"*

### 7.7 `studio.task.mark_done` — 标记完成待审查

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | ✅ | |
| `summary` | string | | 完成总结，说明做了什么 |

**行为**：任务状态变为 `reviewing`，`stage` 更新为 summary 或默认 "Agent 已完成，等待人工确认"。

**返回**：`{ taskId, status: 'reviewing' }`

工具描述：*"当你认为 AI IDE Studio 项目任务已经完成，调用此工具通知用户进行审查。请在 summary 中说明你完成了什么。"*

---

## 八、业务规则

| 编号 | 规则 |
|------|------|
| BR-01 | 任务**必须归属一个项目**，创建时自动关联当前项目 |
| BR-02 | 指派 Agent 后，系统自动创建对话并发送 prompt（含任务工具使用指引），任务状态推进到 `executing` |
| BR-03 | **系统不因 session:done 自动改变任务状态**，任务状态由 Agent 通过工具主动管理 |
| BR-04 | Agent 调用 `mark_done` 后任务进入 `reviewing`，只有人工确认后才变为 `completed` |
| BR-05 | Agent 调用 `update_progress` 时，如果任务处于 `needs_input` 或 `blocked`，自动恢复到 `executing` |
| BR-06 | `completed` 和 `cancelled` 是终态，到达终态时写入 `completed_at` |
| BR-07 | 指派 Agent 但创建对话/发 prompt 失败时，任务状态变为 `blocked`，`stage` 记录错误原因 |
| BR-08 | 删除任务不影响已关联的对话 |
| BR-09 | 由定时规则创建的任务，`source` = `schedule`，`rule_id` 记录来源规则 |
| BR-10 | Agent 创建的任务，`source` = `agent`，归属当前会话所在的项目 |
| BR-11 | 一个任务可以有多个关联对话（重新指派、多轮对话等场景） |
| BR-12 | 任务看板和对话右侧面板始终按当前项目过滤 |
| BR-13 | `studio.task.*` 系列工具为全局内置工具，所有 Agent 默认可用 |
| BR-14 | 工具使用 `studio.` 命名空间前缀，与 Agent Runtime 自带的 task 概念区分 |
| BR-15 | 指派 prompt 必须明确标识「由任务系统触发」，包含完整的任务信息和工具使用说明 |
| BR-16 | 指派时可选择复用已有会话或新建会话，不选则默认新建 |
| BR-17 | 复用已有会话时，prompt 前追加「接续上下文」标识，Agent 可利用已有对话上下文 |
| BR-18 | 由定时规则触发的任务，指派 prompt 中额外标注规则名称和触发时间 |

---

## 九、对标现有实现 — 差距与改造项

### 9.1 现有实现已覆盖的功能

| 功能 | 现有文件 | 完成度 |
|------|---------|--------|
| 任务 CRUD 存储 | `src/store/tasks.ts` | ✅ |
| 任务管理器（创建+指派+自动对话） | `src/core/tasks.ts` | ✅ |
| 任务看板页 | `ui/src/pages/TaskBoard.tsx` | ⚠️ 缺项目过滤 |
| 对话右侧任务面板 | `ui/src/pages/Workspace.tsx` | ⚠️ 只读不可点击 |
| Agent create_task 工具 | `src/tools/handlers/create-task.ts` | ⚠️ 需改命名空间 |
| Agent list_tasks 工具 | `src/tools/handlers/list-tasks.ts` | ⚠️ 需改命名空间 |
| 事件广播 task:update | `src/gateway/ws-handler.ts` | ✅ |
| 前端 store + 实时推送 | `ui/src/stores/task.store.ts` | ✅ |
| task_events 事件溯源 | `src/store/tasks.ts` | ✅ 有写入 |

### 9.2 需要改造的内容

| 改造项 | 说明 | 工作量 |
|--------|------|--------|
| **移除 session:done 自动推进 reviewing** | 删除 `src/core/sessions.ts` 中的自动状态推进逻辑 | 小 |
| **新增 `needs_input` 状态** | TaskStatus 类型增加 `needs_input`，数据库无需改（status 是 TEXT） | 小 |
| **去掉 `planning` 状态** | 从类型定义和看板映射中移除 | 小 |
| **工具重命名**：`core.task.*` → `studio.task.*` | 改 handler 文件名、seed 注册、工具 name/description | 中 |
| **新增 4 个 Agent 工具**：get / update_progress / request_input / mark_blocked / mark_done | 新增 handler | 中 |
| **指派 prompt 模板改造**：完整的任务触发 prompt（含任务上下文 + 工具说明 + 执行要求） | 改 `src/core/tasks.ts` 的 prompt 模板 | 中 |
| **会话选择逻辑**：指派时支持选择已有会话或新建 | 改 `src/core/tasks.ts` + RPC | 小 |
| **TaskBoard 项目过滤** | mount 时按 projectId 加载 | 小 |
| **TaskBoard 看板列调整**：加入 needs_input 和 cancelled | 改列映射 | 小 |
| **TaskBoard 卡片状态高亮**：needs_input 黄边框、blocked 红边框 | 改样式 | 小 |
| **对话右侧面板可点击跳转** | 改交互逻辑 | 中 |
| **RPC 补齐**：tasks.get / tasks.delete / tasks.assign | 新增 RPC handler | 小 |
| **数据库加 rule_id** | 迁移（与定时任务合并） | 小 |
| **统一 source 枚举** | 改类型定义 | 小 |
| **定时规则工具同步重命名**：`core.schedule.*` → `studio.schedule.*` | 保持命名空间一致 | 小 |

### 9.3 不需要改动的内容

| 模块 | 原因 |
|------|------|
| `src/store/tasks.ts` | CRUD + event sourcing 已完备 |
| `src/core/tasks.ts` createTask 主流程 | 创建+指派+自动对话逻辑可复用 |
| `task.store.ts` WS 监听 | task:update 实时推送已接入 |
| `src/core/cron.ts` | cron 解析不受影响 |

### 9.4 建议执行顺序

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 类型改造：去掉 `planning`，新增 `needs_input`，统一 source 枚举 | 无 |
| 2 | 移除 session:done 自动推进逻辑 | 无 |
| 3 | 工具重命名 `studio.task.*` + 新增 4 个工具 handler + seed | 1 |
| 4 | 指派 prompt 模板改造（注入工具使用指引） | 3 |
| 5 | RPC 补齐（get/delete/assign） | 无 |
| 6 | TaskBoard 改造（项目过滤 + 列调整 + 高亮 + 详情增强） | 1 + 5 |
| 7 | 对话右侧面板改造（可点击跳转 + needs_input badge） | 5 |
| 8 | 定时规则工具同步重命名 `studio.schedule.*` | 3 |

---

## 十、验收 Checklist

**基础功能**：
- [ ] 用户可在看板创建任务，归属当前项目
- [ ] 切换项目后，看板只显示当前项目任务
- [ ] 创建时指派 Agent → 自动创建对话并发送含工具指引的 prompt
- [ ] `needs_input` / `blocked` 卡片有视觉高亮
- [ ] 看板详情中可修改状态、指派 Agent、跳转对话、删除

**Agent 工具**：
- [ ] Agent 通过 `studio.task.create` 创建任务
- [ ] Agent 通过 `studio.task.list` 查看任务
- [ ] Agent 通过 `studio.task.get` 查看详情
- [ ] Agent 通过 `studio.task.update_progress` 汇报进度，看板实时更新阶段描述
- [ ] Agent 通过 `studio.task.request_input` 请求输入 → 任务变为 `needs_input`
- [ ] Agent 通过 `studio.task.mark_blocked` 标记阻塞 → 任务变为 `blocked`
- [ ] Agent 通过 `studio.task.mark_done` 标记完成 → 任务变为 `reviewing`
- [ ] Agent 从 `needs_input`/`blocked` 调用 `update_progress` 后 → 恢复为 `executing`

**状态机**：
- [ ] **session:done 不会自动改变任务状态**
- [ ] 只有人工操作可以将任务标记为 `completed`
- [ ] `completed` 和 `cancelled` 是终态，写入 completed_at
- [ ] 人工可以从任意非终态取消任务

**指派 prompt**：
- [ ] 指派 prompt 明确标识「由任务系统触发」
- [ ] prompt 包含任务 ID、标题、描述、来源信息
- [ ] prompt 包含每个工具的用途、时机、示例说明
- [ ] prompt 包含执行要求（何时汇报、何时请求输入、完成后必须 mark_done）
- [ ] 复用已有会话时，prompt 前追加「接续上下文」标识
- [ ] 定时规则触发时，prompt 额外包含规则名称

**会话选择**：
- [ ] 新建任务弹窗：选 Agent 后可选择已有会话或新建
- [ ] 复用已有会话时，在该对话中追加任务指派 prompt
- [ ] Agent 工具 `studio.task.create` 支持 `sessionId` 参数

**工具区分**：
- [ ] 工具使用 `studio.task.*` 命名空间
- [ ] 工具 description 明确标识为"AI IDE Studio 平台工具"

**对话面板**：
- [ ] 右侧面板按项目过滤
- [ ] "需处理" tab 显示 blocked + reviewing 任务数量 badge
- [ ] 点击任务卡片可跳转关联对话
