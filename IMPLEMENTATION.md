# AI IDE Studio — 落地实现文档

## 一、项目概述

基于 **Vite + React 19 + TypeScript** 的 AI IDE 前端工程，实现了以任务为中心、Agent 自主协作的下一代开发工具界面。

### 核心理念

| 概念 | 定义 | 在 UI 中的表现 |
|------|------|----------------|
| **Project** | 顶层命名空间 | 顶栏显示项目名 (PayFlow) |
| **Agent** | 持久化的 AI 实体 | 左侧树 + 状态头像 |
| **Session** | Agent 执行任务的工作记录 | Agent 下的可展开列表 |
| **Task** | 原子化工作单元 | 右侧状态面板 + 看板 |

### 记忆模型设计

```
┌─────────────────────────────────┐
│      System Prompt (稳定)        │ ← 前缀缓存友好
├─────────────────────────────────┤
│      Agent 角色定义 (稳定)       │
├─────────────────────────────────┤
│      对话历史 (append-only)      │ ← 增量缓存
├─────────────────────────────────┤
│      recall_memory() 检索结果    │ ← 动态注入，不影响前缀
└─────────────────────────────────┘
```

- **Agent 级持久记忆** = 可检索知识库（RAG），不塞进 prompt
- **Session 级上下文** = 独立对话历史，不混用
- 多任务时 System 里只显示任务概况，详细上下文通过 tool call 拉取

## 二、技术栈

| 层面 | 选型 | 说明 |
|------|------|------|
| 构建 | Vite 8 | 极快的 HMR |
| 框架 | React 19 | 函数组件 + Hooks |
| 语言 | TypeScript 6 | 严格模式 |
| 路由 | react-router-dom 7 | 声明式路由，Dashboard 为首页 |
| 图标 | lucide-react | 统一图标体系 |
| 样式 | CSS Variables + 内联 | 亮色主题（Cursor/Codex 风格） |

## 三、项目结构

```
ai-ide-studio/
├── docs/                      # 设计文档
├── src/
│   ├── types/index.ts          # 全局类型定义
│   ├── data/mockData.ts        # 模拟数据（6 Agent/5 Task/7 Session/13 Messages）
│   ├── App.tsx                 # 路由配置
│   ├── main.tsx                # 入口
│   ├── index.css               # 全局样式 + CSS 变量
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx   # 主布局（侧边图标栏+顶栏+内容区）
│   │   │   └── AppLayout.css   # 布局样式
│   │   ├── chat/
│   │   │   └── ChatView.tsx    # 对话组件（思考/工具调用/决策）
│   │   └── session/
│   │       └── SessionTimeline.tsx  # Session 时间线
│   └── pages/
│       ├── Workspace.tsx       # 主工作页（三栏布局）
│       ├── Dashboard.tsx       # 总览仪表板
│       ├── TaskBoard.tsx       # 任务看板（Kanban）
│       └── Schedule.tsx        # 定时任务 & 事件规则
├── AGENTS.md                  # Agent 开发指南
├── IMPLEMENTATION.md          # 本文档
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 四、页面功能详解

### 4.1 Workspace 工作台 (`/workspace`)

**三栏布局 = 驾驶舱**

```
┌──────────┬────────────────────────────┬──────────┐
│  Agent   │                            │  Task    │
│  Tree    │      Center Panel          │  Status  │
│  +       │  (Chat/Trace/Detail)       │  +       │
│  Task    │                            │  决策    │
│  List    │                            │  +       │
│          │                            │  日志    │
└──────────┴────────────────────────────┴──────────┘
  260px          flex: 1                   320px
```

**左栏**
- Agent 列表：折叠树，显示名称/状态脉冲/Session 计数
- 每个 Agent 下展开 Session 列表：状态点 + 任务名 + 进度
- 底部 35%：Task 快速列表

**中栏**
- Header：当前 Agent 头像 + 名称 + Session/Task 上下文
- Tab 切换：
  - **对话**：ChatView 组件，支持思考折叠、工具调用展示、决策交互
  - **Session 轨迹**：SessionTimeline 组件，操作时间线
  - **任务详情**：进度、子任务列表
- Footer：输入框 + 发送

**右栏**
- 任务状态：所有任务卡片 + 进度条
- 待决策(N)：未处理的决策卡片 + 可点击选项
- 日志：所有 Agent 操作的合并时间线

### 4.2 Dashboard (`/dashboard`)

- 统计卡片：Agent 数/活跃 Session/任务总数/今日完成/未读通知
- Agent Overview：表格展示各 Agent 状态和任务数
- 通知列表：按类型着色（决策=黄/完成=绿/错误=红/信息=蓝）

### 4.3 Task Board (`/tasks`)

- Kanban 四列：
  - ⚠️ 等待决策 (blocked)
  - 🔄 进行中 (executing/planning/reviewing)
  - ✅ 已完成 (completed)
  - 📦 Backlog (backlog)
- 卡片含：标题、来源 badge、进度条、Agent 头像堆叠、子任务计数
- Hover 有拖拽感（阴影 + 位移）

### 4.4 Schedule (`/schedule`)

- 📅 定时任务：Cron → 可读标签，带 Toggle 开关
- ⚡ 事件触发规则：着色事件标签 + Toggle
- 网格布局：Trigger | Name | Description | Agent | On/Off

## 五、ChatView 交互规范

### 消息类型

| 类型 | 对齐 | 样式 | 特殊元素 |
|------|------|------|----------|
| Agent | 左 | 暗色背景 + 圆角 | Session tag、思考块、工具调用、决策 |
| Human | 右 | 蓝色透明背景 | 无 |
| System | 居中 | 分隔线 + 小字 | 无 |

### 特殊交互

**思考块（Thinking）**
- 默认折叠，点击展开
- 灰色斜体文字，展示 Agent 推理过程

**工具调用（Tool Calls）**
- 状态指示：✅ done / ⏳ running / ❌ error
- 折叠展开：名称 + 状态 → 展开看完整结果
- monospace 字体，左边框着色

**决策点（Decision）**
- 黄色标题 + 选项按钮
- 点击选项 → 标记为已选 + 绿色确认
- 已决策后显示 badge

## 六、数据模型（TypeScript Interfaces）

```typescript
// 核心实体
Agent { id, type, name, avatar, status, permissionLevel, activeSessions, memory, behaviors }
Session { id, agentId, taskId, taskName, status, progress, actions }
Task { id, title, source, status, progress, assignedAgents, subtasks, sessionIds }
ChatMessage { id, role, content, thinking?, toolCalls?, decision? }

// 辅助类型
Behavior { trigger, triggerType, action, agentId, permissionLevel, enabled }
Notification { type, title, description, agentId, read }
```

## 七、样式规范

### 色彩体系 (亮色主题 — Cursor/Codex 风格)

```css
--bg-0: #ffffff    /* 纯白背景 */
--bg-1: #f9fafb    /* 页面背景 */
--bg-2: #f3f4f6    /* 输入/次级卡片 */
--bg-3: #e5e7eb    /* hover/按钮 */
--bg-4: #d1d5db    /* 进度条背景 */
--border: #e5e7eb  /* 分隔线 */
--text-1: #111827  /* 主文字 */
--text-2: #4b5563  /* 次要文字 */
--text-3: #9ca3af  /* 弱化文字 */
--blue: #2563eb    /* 主强调 / Dev */
--green: #059669   /* 成功 / Test */
--yellow: #d97706  /* 警告 / 决策 */
--red: #dc2626     /* 错误 / Security */
--purple: #7c3aed  /* PM / Architect */
--orange: #ea580c  /* Ops */
```

### Agent 类型着色

| Type | 颜色 | 含义 |
|------|------|------|
| dev | blue | 开发 |
| test | green | 测试 |
| ops | orange | 运维 |
| security | red | 安全 |
| architect | purple | 架构 |
| pm | purple | 产品 |

## 八、运行方式

```bash
cd d:\code_space\python_space\ai-ide-studio

# 安装依赖
npm install

# 开发模式（HMR）
npm run dev

# 构建生产版本
npm run build

# 预览生产版本
npm run preview
```

## 九、后续扩展方向

1. **接入真实后端** — WebSocket 实时推送 Agent 状态变更
2. **状态管理** — 引入 Zustand/Jotai 管理全局状态
3. **拖拽排序** — Task Board 支持 dnd-kit 拖拽
4. **代码编辑器** — 集成 Monaco Editor 展示代码变更
5. **记忆面板** — Agent 知识库的可视化管理界面
6. **会话模板** — 预设 System Prompt 的派生机制
7. **权限控制** — Agent 自主行为的 L0-L4 分级设置
8. **项目切换器** — 顶栏项目选择器（已实现）
