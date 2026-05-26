# AI IDE Studio — Agent 开发指南

## 项目简介

AI IDE Studio 是一个面向未来的 AI 编程协作界面原型。不同于传统的"人管会话"模式，它以 **任务为中心、Agent 为主体**，探索 AI 智能体如何自主工作、协作和与人交互。

当前阶段：**前端原型**（仅 UI 和交互，无后端）。

## 技术栈

- **Vite 8** + **React 19** + **TypeScript 6**
- **react-router-dom 7** — 路由
- **lucide-react** — 图标库
- **CSS Variables** — 亮色主题，无 CSS 框架

## 开发指南

### 启动

```bash
cd d:\code_space\python_space\ai-ide-studio
npm install
npm run dev
```

### 构建

```bash
npm run build
```

### 关键路径

| 路径 | 说明 |
|------|------|
| `src/types/index.ts` | 所有 TypeScript 类型定义 |
| `src/data/mockData.ts` | 模拟数据，当前无后端 |
| `src/pages/` | 四个主页面组件 |
| `src/components/` | 可复用组件 |
| `src/index.css` | 全局样式和 CSS 变量 |
| `docs/` | 设计文档 |

### 代码规范

- 函数组件 + Hooks，不用 class 组件
- 接口定义在 `src/types/index.ts`
- 样式优先使用 CSS 变量 + 内联样式，复杂布局用 CSS 文件
- 所有 UI 文本使用中文
- 组件命名 PascalCase，文件名和目录名 camelCase 或 kebab-case

### 设计原则

1. **界面风格** — 亮色主题，Cursor/Codex 风格，简洁专业
2. **AI 任务无百分比** — 用阶段描述（stage）代替进度条
3. **交互完整** — 所有按钮必须可点击，有对应的弹窗或动作
4. **中文界面** — 所有面向用户的文本均为中文

### 核心设计思路

详见 `docs/` 目录：
- `01-vision.md` — 设计愿景和核心理念
- `02-architecture.md` — 技术架构和项目结构
- `03-requirements.md` — 功能需求规格
- `04-memory-model.md` — Agent 记忆模型设计
- `05-session-lifecycle.md` — Session 生命周期管理
- `06-interaction-patterns.md` — 交互模式设计

### 实体关系

```
Project 1:N Agent（项目拥有多个 Agent 实例）
Agent   1:N Session（Agent 管理多个会话）
Task    1:N Session（任务关联多个会话记录）
Task    N:1 Agent（任务可指派给一个主 Agent）
```

### 后续规划

- [ ] 接入真实后端（WebSocket 实时通信）
- [ ] Agent 记忆系统（RAG + 向量数据库）
- [ ] 真正的多 Agent 协作引擎
- [ ] 插件系统（自定义 Agent 类型）
- [ ] 与 Git / CI/CD 的深度集成
