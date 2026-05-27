# 贡献指南

## 开发环境

参考 [快速上手](docs/guides/getting-started.md) 完成环境搭建。

## 代码规范

### 命名约定

| 类型 | 规则 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `session-events.ts` |
| React 组件 | PascalCase | `ChatView.tsx` |
| 函数/变量 | camelCase | `sendPrompt()` |
| 类型/接口 | PascalCase | `SessionCapabilities` |
| DB 字段 | snake_case | `agent_id` |
| CSS 变量 | kebab-case | `--bg-1` |

### 文件组织

- **后端类型**定义在 `src/types/ws-protocol.ts`
- **前端类型**定义在 `ui/src/types/index.ts`
- 单文件行数上限：后端 400 行，前端组件 300 行
- 超过上限时，拆分为子模块或子组件

### 导入规则

- 使用 named exports，避免 default export
- 后端导入使用 `.js` 扩展名（TypeScript nodenext 解析）
- 前端导入使用 `.ts` / `.tsx` 扩展名

### 样式

- 优先使用 CSS 变量（`var(--bg-1)`）+ 内联样式
- 复杂布局使用独立 CSS 文件
- 颜色、间距、圆角等必须使用 CSS 变量

### 语言

- 所有面向用户的文本使用**中文**
- 代码注释用中文或英文均可，保持一致性
- 文档根据受众选择语言（开发文档中文，README 中英双语）

## 测试要求

- 新功能必须有对应测试
- 修 bug 必须先写复现测试
- 提交前运行 `npm test` 确保全部通过
- 详见 [测试指南](docs/guides/testing.md)

## AI 开发后的文档更新

每次通过 AI Agent 完成功能开发后，必须执行以下检查：

| 变更类型 | 需要更新的文档 |
|----------|----------------|
| 新模块/文件 | `docs/architecture/overview.md` 目录映射 |
| 新 WS RPC 方法 | `docs/architecture/ws-protocol.md` |
| 新实体/状态变更 | `docs/architecture/data-model.md` |
| 新用户功能 | `README.md` 功能列表 |
| API 路径变更 | `AGENTS.md` 中的类型路径 |

## 项目结构

```
ai-ide-studio/
├── src/           # 后端 Gateway（Hono + WS + SQLite + ACP）
├── ui/            # 前端 React 应用（Vite + Zustand）
├── tests/         # 测试（unit + integration）
├── scripts/       # 工具脚本
├── docs/          # 文档
│   ├── design/        # 设计文档（愿景、记忆模型、交互模式）
│   ├── architecture/  # 架构文档（随代码同步更新）
│   └── guides/        # 开发指南（环境搭建、测试）
├── AGENTS.md      # AI Agent 开发行为规范
├── CONTRIBUTING.md # 本文档
└── README.md      # 项目说明
```
