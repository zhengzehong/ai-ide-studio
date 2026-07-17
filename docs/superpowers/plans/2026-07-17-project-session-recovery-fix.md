# Project Session Recovery Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 A -> C -> A 项目切换时 A 的 last-session 映射被错误清除的问题。

**Architecture:** 保留 Workspace 现有清理和恢复两个 effect，只增加一个纯判断函数区分跨项目过渡与当前项目会话真实失效。Session store、消息缓存和 WS 订阅逻辑不变。

**Tech Stack:** React 19、TypeScript、Zustand、Vitest。

---

### Task 1: 用最小测试锁定映射清理条件

**Files:**
- Modify: `tests/unit/workspace-session-agent.test.ts`
- Modify: `ui/src/pages/workspace/helpers.ts`

- [ ] **Step 1: 写失败测试**

在现有 Workspace session helper 测试中增加两个断言：

```ts
expect(shouldClearProjectLastSessionForMissingCurrent('session-c', 'session-a')).toBe(false)
expect(shouldClearProjectLastSessionForMissingCurrent('session-a', 'session-a')).toBe(true)
```

- [ ] **Step 2: 验证测试失败**

Run: `npx vitest run tests/unit/workspace-session-agent.test.ts`

Expected: FAIL，因为 helper 尚未导出。

- [ ] **Step 3: 实现最小纯函数**

在 `ui/src/pages/workspace/helpers.ts` 增加：

```ts
export function shouldClearProjectLastSessionForMissingCurrent(
  currentSessionId: string,
  projectLastSessionId: string | null,
): boolean {
  return currentSessionId === projectLastSessionId
}
```

- [ ] **Step 4: 验证定向测试通过**

Run: `npx vitest run tests/unit/workspace-session-agent.test.ts`

Expected: PASS。

### Task 2: 接入 Workspace 清理路径

**Files:**
- Modify: `ui/src/pages/Workspace.tsx:323`
- Test: `tests/unit/workspace-session-agent.test.ts`

- [ ] **Step 1: 仅在当前项目会话真实失效时清映射**

在会话不属于当前列表的 effect 中读取 `readProjectLastSession(currentProjectId)`；只有 helper 返回 `true` 才调用 `clearProjectLastSession(currentProjectId)`，之后始终 `selectSession(null)` 让现有恢复 effect 接管。

- [ ] **Step 2: 运行定向回归**

Run: `npx vitest run tests/unit/workspace-session-agent.test.ts tests/unit/session-project-cache.test.ts`

Expected: PASS。

- [ ] **Step 3: 运行完整门禁**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: 全部退出码 0。

- [ ] **Step 4: 提交并请求 code-reviewer**

```bash
git add ui/src/pages/Workspace.tsx ui/src/pages/workspace/helpers.ts tests/unit/workspace-session-agent.test.ts docs/superpowers/specs/2026-07-17-project-session-recovery-design.md docs/superpowers/plans/2026-07-17-project-session-recovery-fix.md
git commit -m "fix(ui): preserve project session selection"
```
