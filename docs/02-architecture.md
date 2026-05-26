# 系统架构

## 技术栈

| 层面 | 选型 | 说明 |
|------|------|------|
| 构建 | Vite 8 | 极快的 HMR |
| 框架 | React 19 | 函数组件 + Hooks |
| 语言 | TypeScript 6 | 严格模式 |
| 路由 | react-router-dom 7 | 声明式路由 |
| 图标 | lucide-react | 统一图标体系 |
| 样式 | CSS Variables + 内联样式 | 亮色主题，Cursor/Codex 风格 |

## 页面结构

```
/              → Dashboard（项目概览，首页）
/workspace     → Workspace（三栏工作台）
/tasks         → TaskBoard（任务看板）
/schedule      → Schedule（自动化规则）
```

## 目录结构

```
ai-ide-studio/
├── docs/                       # 设计文档
│   ├── 01-vision.md           # 设计愿景
│   ├── 02-architecture.md     # 架构文档（本文件）
│   └── 03-requirements.md     # 需求规格
├── src/
│   ├── types/index.ts         # 全局 TypeScript 类型
│   ├── data/mockData.ts       # 模拟数据
│   ├── App.tsx                # 路由配置
│   ├── main.tsx               # 入口
│   ├── index.css              # 全局样式 + CSS 变量
│   ├── components/
│   │   ├── layout/            # 主布局（侧栏+顶栏+内容区）
│   │   ├── chat/              # 对话组件
│   │   └── session/           # Session 时间线
│   └── pages/
│       ├── Dashboard.tsx      # 概览首页
│       ├── Workspace.tsx      # 三栏工作台
│       ├── TaskBoard.tsx      # 任务看板
│       └── Schedule.tsx       # 自动化规则
├── AGENTS.md                  # AI Agent 开发指南
├── IMPLEMENTATION.md          # 实现说明
├── package.json
└── tsconfig.json
```

## 数据模型

### 核心类型

```typescript
type AgentType = 'dev' | 'test' | 'ops' | 'security' | 'architect' | 'pm'
type AgentStatus = 'busy' | 'idle' | 'standby'
type SessionStatus = 'active' | 'waiting' | 'suspended' | 'completed'
type TaskStatus = 'backlog' | 'planning' | 'executing' | 'blocked' | 'reviewing' | 'completed' | 'cancelled'
type TaskSource = 'human' | 'agent' | 'event' | 'schedule'
type PermissionLevel = 0 | 1 | 2 | 3 | 4
```

### 关键设计决策

1. **没有"进度百分比"** — AI 编程无法量化进度，用阶段描述（stage）代替
2. **Session 不等于对话** — Session 是 Agent 的工作记录，人参与只是其中一部分
3. **Project = Workspace** — 单项目工作模式，切换项目通过顶栏下拉
4. **记忆通过 RAG** — Agent 记忆不在 prompt 里，通过 recall_memory 工具检索

## 样式规范

亮色主题，CSS 变量：

```css
--bg-0: #ffffff     /* 纯白 */
--bg-1: #f9fafb     /* 页面底色 */
--bg-2: #f3f4f6     /* 卡片/输入框 */
--bg-3: #e5e7eb     /* hover */
--border: #e5e7eb   /* 边框 */
--blue: #2563eb     /* 主强调色 */
--green: #059669    /* 成功 */
--red: #dc2626      /* 错误/警告 */
--purple: #7c3aed   /* 辅助 */
```

## 组件设计原则

1. 所有按钮必须有交互反馈（hover/active 状态）
2. 弹窗使用 backdrop + 动画
3. 列表项 hover 显示阴影
4. 表单 focus 显示蓝色边框
5. 信息密度适中 — 不要太密也不要太空
