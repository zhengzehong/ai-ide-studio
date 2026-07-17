# Project Session Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PC 项目切换器、固定项目 Tab 和溢出菜单中，为所有项目（包括从未访问的项目）准确展示运行中会话数和未读会话数。

**Architecture:** 后端新增只读 `sessions.projectStats` RPC，以一次轻量查询读取全部项目会话的运行信号和已读时间，并与内存 active prompt 合并后生成完整统计快照。前端使用独立 Zustand store 保存快照，通过连接、重连、切换器打开和会话事件去抖刷新；统计不进入项目页面 LRU，也不新增已读写接口，打开具体会话继续使用现有 `sessions.markRead`。

**Tech Stack:** TypeScript 6、Hono/ws RPC、better-sqlite3、React 19、Zustand 5、Vitest 4、CSS Variables

---

### Task 1: 共享运行态判定与后端聚合查询

**Files:**
- Create: `src/store/session-runtime-state.ts`
- Create: `src/store/session-stats.ts`
- Modify: `src/store/sessions.ts`
- Test: `tests/unit/session-runtime-signals.test.ts`
- Test: `tests/integration/project-session-stats.test.ts`

- [x] **Step 1: 写运行态纯函数失败测试**

覆盖 active prompt、运行中 Agent message、运行中 process item、已知运行 stage，以及 idle 优先阻止 stage 回退误判：

```ts
expect(resolveSessionRuntimeState({
  promptActive: true,
  hasRunningAgentMessage: false,
  hasRunningProcessItem: false,
  status: 'active',
  stage: '',
})).toBe('running')
```

- [x] **Step 2: 运行纯函数测试并确认 RED**

Run: `npx vitest run tests/unit/session-runtime-signals.test.ts`

Expected: FAIL，提示 `session-runtime-state.ts` 不存在或导出缺失。

- [x] **Step 3: 实现共享运行态纯函数并替换原私有判断**

```ts
export interface SessionRuntimeSignals {
  promptActive: boolean
  hasRunningAgentMessage: boolean
  hasRunningProcessItem: boolean
  status: string
  stage: string | null
}

export function resolveSessionRuntimeState(signals: SessionRuntimeSignals): SessionRuntimeState
```

`src/store/sessions.ts` 的 `listWithRuntimeState` 继续执行已有 DB 探测，但最终调用该纯函数，保证会话列表和项目统计口径一致。

- [x] **Step 4: 写项目聚合失败测试**

建立两个项目，覆盖以下数据：运行中会话、运行且时间戳未读的会话、普通未读会话、已读会话、模板会话、软删除会话和无项目会话。断言：

```ts
expect(stats).toEqual([
  { projectId: projectA.id, runningCount: 2, unreadCount: 1 },
  { projectId: projectB.id, runningCount: 0, unreadCount: 0 },
])
```

- [x] **Step 5: 运行聚合测试并确认 RED**

Run: `npx vitest run tests/integration/project-session-stats.test.ts`

Expected: FAIL，提示 `projectSessionStatsStore` 不存在。

- [x] **Step 6: 实现一次查询 + 内存折叠**

`src/store/session-stats.ts` 用一条 SQL 读取非删除、非模板、有项目归属的 Session，并通过 `EXISTS` 计算 DB 运行信号；应用层调用 `isPromptActive(sessionId)` 合并内存信号后按 `project_id` 折叠。未读仅在 `runtimeState === 'idle'` 且两个时间戳有效并满足 `last_message_at > last_read_at` 时计数。

- [x] **Step 7: 运行后端定向测试并提交**

Run: `npx vitest run tests/unit/session-runtime-signals.test.ts tests/integration/project-session-stats.test.ts`

Expected: PASS。

Commit: `feat(server): add project session stats aggregation`

### Task 2: 注册只读 RPC 和协议契约

**Files:**
- Create: `src/gateway/rpc/session-stats.ts`
- Modify: `src/gateway/rpc/registry.ts`
- Modify: `src/types/ws-protocol.ts`
- Modify: `tests/integration/project-session-stats.test.ts`

- [x] **Step 1: 写 RPC 失败测试**

通过真实 `handleWsConnection` 发送：

```ts
await ws.send({ type: 'sessions.projectStats', requestId: 'req-stats' })
expect(ws.last()).toMatchObject({
  type: 'result',
  requestId: 'req-stats',
  data: { generatedAt: expect.any(String), items: expect.any(Array) },
})
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `npx vitest run tests/integration/project-session-stats.test.ts`

Expected: FAIL，返回 `未知消息类型: sessions.projectStats`。

- [x] **Step 3: 实现协议和独立 RPC handler**

```ts
export interface SessionsProjectStatsMsg extends ClientMessage {
  type: 'sessions.projectStats'
}

export interface ProjectSessionStatsData {
  projectId: string
  runningCount: number
  unreadCount: number
}
```

新 handler 调用 `projectSessionStatsStore.list((sessionId) => sessionManager.isPromptActive(sessionId))`，并返回 `{ generatedAt, items }`。不向已超过 400 行的 `src/gateway/rpc/sessions.ts` 继续追加代码。

- [x] **Step 4: 运行 RPC 测试并提交**

Run: `npx vitest run tests/integration/project-session-stats.test.ts`

Expected: PASS。

Commit: `feat(server): expose project session stats rpc`

### Task 3: 前端独立 stats store 与刷新状态机

**Files:**
- Create: `ui/src/stores/project-session-stats.store.ts`
- Test: `tests/unit/project-session-stats-store.test.ts`

- [x] **Step 1: 写快照、失败保留和乱序保护测试**

测试 `fetchStats()` 把数组转为 `statsByProjectId`；失败时保留上次成功数据；较旧请求后返回时不能覆盖新快照。

- [x] **Step 2: 写事件去抖测试**

使用 `vi.useFakeTimers()`，连续触发 `session:activity` 和 `session:changed`，推进 299ms 时无请求，推进到 300ms 后只请求一次 `sessions.projectStats`。

- [x] **Step 3: 运行 store 测试并确认 RED**

Run: `npx vitest run tests/unit/project-session-stats-store.test.ts`

Expected: FAIL，提示 store 模块不存在。

- [x] **Step 4: 实现 store**

```ts
interface ProjectSessionStatsStore {
  statsByProjectId: Record<string, ProjectSessionStatsData>
  initialized: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  fetchedAt: number | null
  requestSeq: number
  fetchStats: (options?: { force?: boolean }) => Promise<void>
  refreshIfStale: (maxAgeMs?: number) => Promise<void>
  setupListeners: () => () => void
}
```

模块级 timer 只负责 300ms debounce；cleanup 必须清 timer 并注销两个 WS listener。首次加载和后台刷新分别驱动 `loading/refreshing`；失败不清空 `statsByProjectId`。

- [x] **Step 5: 运行 store 测试并提交**

Run: `npx vitest run tests/unit/project-session-stats-store.test.ts`

Expected: PASS。

Commit: `feat(ui): add project session stats store`

### Task 4: PC 项目切换 UI 展示

**Files:**
- Create: `ui/src/components/layout/ProjectActivityBadges.tsx`
- Modify: `ui/src/components/layout/ProjectSwitcher.tsx`
- Modify: `ui/src/components/layout/ProjectTabBar.tsx`
- Modify: `ui/src/components/layout/AppLayout.css`
- Test: `tests/unit/project-activity-badges.test.ts`

- [x] **Step 1: 写 badge 渲染失败测试**

使用 `renderToStaticMarkup` 验证运行中和未读分别渲染、0 不渲染、100 显示 `99+`，并保留中文 title：

```ts
expect(renderProjectActivityBadges({ runningCount: 3, unreadCount: 2 }))
  .toContain('运行中会话：3')
```

- [x] **Step 2: 运行组件测试并确认 RED**

Run: `npx vitest run tests/unit/project-activity-badges.test.ts`

Expected: FAIL，提示组件不存在。

- [x] **Step 3: 实现共享 badge 组件**

组件只接收 `stats` 和 `compact`，不读取 store；两种状态都使用稳定尺寸的点和数字，运行中使用 `var(--green)`，未读使用 `var(--yellow)`，数量为 0 或 stats 未知时不渲染。

- [x] **Step 4: 接入 ProjectSwitcher 和 ProjectTabBar**

`ProjectSwitcher` 打开时调用 `refreshIfStale()`，所有项目行展示 badge。`ProjectTabBar` 的可见 Tab、overflow 菜单和“上一个项目”入口使用同一组件；点击项目仍只导航，不新增批量已读行为。

- [x] **Step 5: 运行组件和 store 测试并提交**

Run: `npx vitest run tests/unit/project-activity-badges.test.ts tests/unit/project-session-stats-store.test.ts`

Expected: PASS。

Commit: `feat(ui): show project activity counts in switcher`

### Task 5: 应用生命周期、文档与完整验证

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `README.md`

- [x] **Step 1: 接入连接生命周期**

每次 `connected === true` 调用 `fetchStats({ force: connectedOnce.current })`；在现有统一 listener setup/cleanup 中加入 stats store。重连保留旧快照，同时强制刷新。

- [x] **Step 2: 更新稳定架构与协议文档**

`ws-protocol.md` 记录 `sessions.projectStats` 返回结构；`overview.md` 说明 stats store 与项目页面 LRU 的边界；README 的 PC 项目切换条目补充运行中/未读提示。

- [x] **Step 3: 运行全部定向测试**

Run: `npx vitest run tests/unit/session-runtime-signals.test.ts tests/integration/project-session-stats.test.ts tests/unit/project-session-stats-store.test.ts tests/unit/project-activity-badges.test.ts`

Expected: PASS。

- [x] **Step 4: 运行完整质量门禁**

Run: `npm test`

Run: `npm run build`

Run: `npm run lint`

Run: `git diff --check`

Expected: 全部退出码为 0；`mobile/` 无改动。

- [x] **Step 5: 浏览器验收**

启动本 worktree 的 Gateway 和 Vite 到未占用端口，验证桌面宽屏和窄屏：未访问项目有统计、运行结束后绿数下降/未读数变化、打开具体会话后未读下降、ProjectSwitcher/Tab/overflow 无文字挤压或重叠。验收后停止本次启动的服务。

- [ ] **Step 6: 提交并请求 code-reviewer**

Commit: `docs: document project session stats`

向 code-reviewer 提交完整验收清单；处理所有 P0/P1 和本功能相关 P2 后重新运行质量门禁。
