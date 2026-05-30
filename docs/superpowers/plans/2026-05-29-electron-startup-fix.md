# Electron Startup Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Electron 打包版启动后端时递归拉起 `AI IDE Studio.exe` 的问题，并输出明确的安装包与便携包。

**Architecture:** Electron 主进程仍保持“桌面壳 + 本地 HTTP/WS 后端”的架构，但后端子进程必须以 Node 兼容模式运行，不能把 Electron exe 当普通 Node 直接执行。打包配置输出 NSIS 安装包和 portable 便携包，同时文档明确 `win-unpacked` 只是构建中间目录。

**Tech Stack:** Electron 40、electron-builder、TypeScript、Vitest、Node child_process。

---

### Task 1: 后端启动命令防递归

**Files:**
- Modify: `electron/main.ts`
- Test: `tests/unit/electron-startup.test.ts`

- [x] **Step 1: 写失败测试**

新增测试覆盖：当 executable 是打包后的 `AI IDE Studio.exe` 时，后端子进程不能再使用应用 exe 递归启动；应优先使用随包携带的普通 Node，可通过 `AI_IDE_NODE_CMD` 覆盖，并且必须注入 `STATIC_DIR`。

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/unit/electron-startup.test.ts`
Expected: FAIL，提示缺少可测试 helper 或环境变量。

- [x] **Step 3: 最小实现**

在 Electron 层抽出 `createBackendLaunchOptions()`，由 `startBackend()` 使用。该 helper 负责生成：

- `command = resources/node/node.exe`（不存在时用 `AI_IDE_NODE_CMD` 或系统 `node.exe` 兜底）
- `args = [entryPath]`
- 不注入 `ELECTRON_RUN_AS_NODE`
- `env.STATIC_DIR = <resources>/app/ui/dist`
- `env.NODE_PATH` 指向打包后的 `node_modules`

- [x] **Step 4: 运行测试通过**

Run: `npx vitest run tests/unit/electron-startup.test.ts`
Expected: PASS。

---

### Task 2: 打包产物目标与文档修正

**Files:**
- Modify: `electron/builder.config.ts`
- Modify: `docs/architecture/desktop-packaging.md`
- Modify: `.gitignore`

- [x] **Step 1: 改打包目标**

Windows target 同时输出：

- `nsis` 安装包
- `portable` 便携单 exe

- [x] **Step 2: 文档说明**

在桌面打包文档中明确：

- `win-unpacked/` 是 electron-builder 构建中间展开目录，不是给用户分发的“免安装包”。
- 用户分发文件是 NSIS 安装包或 portable exe。
- Electron 后端子进程必须用普通 Node 防止递归启动，并避免 native module ABI 冲突。

- [x] **Step 3: 忽略构建产物**

`.gitignore` 增加 `release/`。

---

### Task 3: 构建、打包、冒烟审查

**Files:**
- No source edits unless verification reveals a bug.

- [x] **Step 1: 清理旧产物**

Run: remove `release/`。

- [x] **Step 2: 构建与测试**

Run:

```bash
npm run build
npx vitest run tests/unit/electron-startup.test.ts
npm test
```

- [x] **Step 3: 打包**

Run:

```bash
npm run build:electron
npm rebuild better-sqlite3
```

- [x] **Step 4: 冒烟启动**

运行 `release/win-unpacked/AI IDE Studio.exe`，用进程列表验证短时间内只有一个 `AI IDE Studio.exe`，没有递归爆进程。随后关闭进程。

- [x] **Step 5: 审查**

Run:

```bash
git diff --check
git status --short
```

列出最终安装包和 portable 包路径。
