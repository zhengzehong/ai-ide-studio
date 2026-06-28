# 快速上手

## 环境要求

- **Node.js** >= 20
- **npm** >= 9
- 可选：Claude Code 或 Codex CLI（用于真实 Agent 运行时）

## 安装

```bash
git clone https://github.com/zhengzehong/ai-ide-studio.git
cd ai-ide-studio
npm install
```

## 配置

复制环境变量模板：

```bash
cp .env.example .env
```

默认配置：
- `PORT=18800` — Gateway 端口
- `DATA_DIR=./data` — 数据目录（SQLite 数据库）
- `GLOBAL_ASSISTANT_WORKSPACE_ROOT` — 可选；全局助理工作空间根目录，未设置时使用系统应用数据目录

## 启动

### 开发模式（推荐）

```bash
npm run dev:all    # 同时启动 Gateway + UI
```

分别启动：

```bash
npm run dev        # Gateway（后端，端口 18800）
npm run dev:ui     # UI（前端，默认 5173，代理到 18800）
```

### 生产构建

```bash
npm run build      # 编译后端 + 构建前端
npm start          # 运行编译后的 Gateway
```

## 访问

- **Web UI**: http://localhost:5173（开发模式）
- **Gateway API**: http://localhost:18800
- **健康检查**: http://localhost:18800/api/health

## 运行测试

```bash
npm test                    # 运行所有测试
npm run test:unit           # 仅单元测试
npm run test:integration    # 仅集成测试
npm run test:watch          # 监听模式
```

## Agent 运行时

首次启动时系统会自动创建 `claude` 和 `codex` 两个默认 Agent。

- **mock** 运行时不需要任何外部依赖，适合开发和 UI 调试
- **claude** 需要本地安装 Claude Code CLI
- **codex** 需要本地安装 Codex CLI

在 Workspace 页面选择 Agent，创建 Session 即可开始对话。
