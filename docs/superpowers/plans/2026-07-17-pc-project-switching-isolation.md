# PC Project Switching Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC 端切换项目时恢复目标项目上次页面和关键视图状态，立即展示该项目缓存，并在后台刷新数据，避免重复加载和跨项目状态污染。

**Architecture:** 项目页使用 `/p/:projectId/*` 作为 URL 真源；项目切换器保存并恢复每个项目的最后子路径。Zustand store 保留现有公开操作，但把列表数据改成按项目作用域缓存，使用 stale-while-revalidate、逐作用域请求序号和 WebSocket 定向更新保证新鲜度。组件状态不使用通用 keep-alive，而是只持久化 Workspace、TaskBoard、Knowledge Base、Event Center 等页面的必要 view-state。

**Tech Stack:** React 19、React Router DOM 7、Zustand 5、TypeScript 6、Vitest 4、WebSocket RPC

---

## 1. 范围与完成定义

### 1.1 本轮范围

- 只实现 PC Web/Electron UI；`mobile/` 不改行为。
- 项目页包括：工作台、任务、任务模式、自动化、事件中心、知识库、Agent 记忆。
- 全局页继续使用原路径：概览、Agent 广场、技能、工具、项目管理、分享、模板、设置。
- 项目切换恢复目标项目最后路径、查询参数和关键页面状态。
- 已访问项目的数据切回时立即显示；后台刷新不得先清空列表或展示全屏 loading。
- 当前可见项目和后台项目的 WebSocket 更新都进入正确缓存。
- 不安装 `react-activation`，不关闭 `StrictMode`，不改成多棵页面树 `display:none`。

### 1.2 明确不做

- 不实现每个项目独立的浏览器 history 栈；浏览器前进/后退仍是单一 history。
- 不缓存所有弹窗的临时开关，只保存切换项目后用户自然期望恢复的状态。
- 不持久化聊天消息的第二份项目缓存；现有 `sessionCaches: Map<sessionId, SessionCache>` 保持按 sessionId 管理。
- 不新增数据库实体或迁移。
- 不在本轮统一重构全部 Zustand store；只改项目切换相关的数据面。

### 1.3 验收场景

1. A 项目停在 `/tasks?status=running`，B 项目停在 `/workspace?sessionId=...`；A → B → A 后分别回到各自路径。
2. A 项目任务看板选中任务并滚动，切到 B 再切回 A，选中项和滚动位置恢复。
3. 已访问项目切回时首帧展示缓存，不出现空列表或全屏加载；缓存过期后后台刷新。
4. 查看 A 时收到 B 的 task/session 更新，切回 B 能直接看到更新。
5. A、B 请求并发且响应乱序时，A 响应不能覆盖 B 当前视图。
6. 直接打开 `/p/B/workspace` 时，项目 store 同步为 B；非法项目 ID 跳转项目管理页并显示中文错误提示。
7. 旧链接 `/workspace`、`/tasks` 等能重定向到当前有效项目的等价新链接。
8. `/share/:token`、`/widget` 和所有全局页路径不受影响。

## 2. 核心设计决策

### 2.1 URL 是项目页面的真源

项目页不得只读取 `project.store.currentProjectId` 判断数据作用域。`ProjectScopeLayout` 从 `:projectId` 校验项目，通过 Outlet context 把 route projectId 传给页面，在 layout effect 中同步 store 并激活缓存，然后才渲染 keyed `<Outlet>`。项目参数变化时项目页子树会 remount，但数据和必要 view-state 都从分区缓存同步恢复，因此不会显示上一个项目状态，也不依赖 keep-alive。切换器只调用统一的 `switchProject(targetProjectId)`，禁止各入口自行拼 URL。

项目子路径固定为：

```ts
export const PROJECT_ROUTE_PATHS = [
  '/workspace',
  '/tasks',
  '/tasks/modes',
  '/schedule',
  '/events',
  '/knowledge',
  '/agent-memory',
] as const
```

每个项目最后位置写入 localStorage：

```ts
interface ProjectLocationMemory {
  pathname: string
  search: string
  hash: string
  updatedAt: number
}

type ProjectLocationMap = Record<string, ProjectLocationMemory>
```

只接受上述项目子路径；解析失败、JSON 损坏或路径越界时回退 `/workspace`，避免把 `/settings` 等全局路径错误挂到项目下。

### 2.2 缓存使用 stale-while-revalidate

统一缓存条目：

```ts
export interface ProjectCacheEntry<T> {
  data: T
  fetchedAt: number
  lastAccessedAt: number
  invalidated: boolean
  error: string | null
}

export interface ProjectCacheState<T> {
  entries: Record<string, ProjectCacheEntry<T>>
  requestSeqByScope: Record<string, number>
}
```

规则：

- `projectId` 使用自身作为 scope key；无 projectId 的全局查询使用 `__all__`。
- TTL 默认 30 秒，通过常量 `PROJECT_CACHE_TTL_MS` 管理。
- 有缓存时同步激活，`loading=false`、`refreshing=true` 后静默刷新。
- 无缓存时才设置 `loading=true`。
- 每个 scope 独立 request sequence；只接受该 scope 最新响应。
- 每个 store 最多保留 5 个项目缓存，`__all__` 不计入上限；LRU 不淘汰当前项目。
- 写操作成功后乐观更新对应缓存；无法安全合并时只标记该 scope `invalidated=true`。

### 2.3 WebSocket 更新策略

- 完整实体且包含 `project_id`：更新对应项目缓存，同时更新 `__all__` 缓存。
- 只有 entity ID 的局部 patch：在所有已缓存 scope 中按 ID 更新；未命中则标记相关活动 scope 失效。
- 删除事件：从所有 scope 删除该 ID。
- 无法判定项目的集合级事件：把已访问 scope 标记失效，只立即刷新当前活动 scope。
- WebSocket 推送不得读取 `useProjectStore.getState().currentProjectId` 后丢弃其他项目事件。

### 2.4 只保存必要 view-state

```ts
interface ProjectViewState {
  workspace?: {
    sidebarTab?: 'sessions' | 'files' | 'tasks'
    selectedAgentId?: string | null
    scrollTopByPanel?: Record<string, number>
  }
  tasks?: {
    selectedTaskId?: string | null
    statusFilter?: string
    scrollLeft?: number
    scrollTopByColumn?: Record<string, number>
  }
  knowledge?: {
    currentKbId?: string | null
    currentPageId?: string | null
    query?: string
  }
  events?: {
    tab?: 'events' | 'categories' | 'subscriptions'
    selectedEventId?: string | null
  }
  agentMemory?: {
    selectedAgentId?: string | null
    selectedDimensionId?: string | null
  }
}
```

Workspace 的聊天输入草稿继续复用现有 session draft 机制，不在 `ProjectViewState` 再存一份。知识库编辑中的未保存正文需要按 `projectId + pageId` 保存草稿，切回时恢复并继续显示 dirty 状态。

## 3. 文件结构

### 新增

| 文件 | 职责 |
|---|---|
| `ui/src/routing/project-routes.ts` | 项目路径识别、拼接、旧路径迁移、localStorage 路径记忆 |
| `ui/src/hooks/use-project-navigation.ts` | 统一项目切换和项目内跳转 |
| `ui/src/hooks/use-project-scope.ts` | 从 Outlet context 读取当前 route projectId，供项目页作为数据作用域真源 |
| `ui/src/components/project/ProjectScopeLayout.tsx` | 校验 URL 项目、同步 store、激活数据 scope、记录位置 |
| `ui/src/components/project/LegacyProjectRedirect.tsx` | 旧项目路径重定向 |
| `ui/src/components/layout/ProjectSwitcher.tsx` | 从超长 `AppLayout.tsx` 拆出的项目下拉切换器 |
| `ui/src/components/layout/ProjectTabBar.tsx` | 从 `AppLayout.tsx` 拆出的固定项目 Tab 与快捷键 |
| `ui/src/stores/project-cache.ts` | 通用 scope key、TTL、LRU、patch、request sequence 纯函数 |
| `ui/src/stores/session-list-cache.ts` | Session 列表缓存和 WS patch 逻辑；消息缓存仍留在 session store |
| `ui/src/stores/project-view-state.store.ts` | 按项目保存关键视图状态 |
| `ui/src/project-scope/project-data-scope.ts` | 激活、失效、清理各项目 store 的公开适配层 |
| `ui/src/pages/workspace/use-workspace-project-state.ts` | Workspace 项目 view-state 读写与滚动恢复，避免继续扩大超长页面文件 |
| `tests/unit/project-routes.test.ts` | 路由与路径记忆测试 |
| `tests/unit/project-cache.test.ts` | 通用缓存策略测试 |
| `tests/unit/task-project-cache.test.ts` | Task 分区缓存与 WS 测试 |
| `tests/unit/agent-project-cache.test.ts` | Agent 分区缓存测试 |
| `tests/unit/session-project-cache.test.ts` | Session 列表分区、乱序、推送测试 |
| `tests/unit/project-view-state.test.ts` | view-state 更新、恢复、清理测试 |

### 修改

| 文件 | 改动 |
|---|---|
| `ui/src/App.tsx` | 建立 `/p/:projectId/*` 路由树、旧路径重定向，调整启动预取 |
| `ui/src/components/layout/AppLayout.tsx` | 只保留布局和导航组装，移除已拆组件 |
| `ui/src/stores/project.store.ts` | 增加项目列表初始化状态；删除项目后触发缓存清理 |
| `ui/src/stores/task.store.ts` | tasks/modes 按 scope 缓存，推送跨 scope 更新 |
| `ui/src/stores/agent.store.ts` | agents 按 scope 缓存，状态推送跨 scope 更新 |
| `ui/src/stores/session.store.ts` | session 列表按 scope 缓存，保留按 sessionId 消息缓存 |
| `ui/src/stores/filesystem.store.ts` | 文件树和打开文件状态按 projectId 缓存 |
| `ui/src/stores/knowledge-base.store.ts` | 知识库、页面、选中项、活动按项目分区 |
| `ui/src/stores/rule.store.ts` | rules 按 scope 缓存；executions 继续按 ruleId 按需读取 |
| `ui/src/stores/event-center.store.ts` | category/event/subscription/detail 按项目分区 |
| `ui/src/stores/agent-memory.store.ts` | dimension/entry 按 project+agent+dimension 分区 |
| `ui/src/pages/Workspace.tsx` | 使用统一 scope 激活；恢复侧栏和滚动；移除重复清空式 fetch |
| `ui/src/pages/TaskBoard.tsx` | 恢复选中任务/滚动；用 navigate 替换 hash 跳转 |
| `ui/src/pages/TaskModesSettings.tsx` | 使用项目路由和 modes 项目缓存 |
| `ui/src/pages/KnowledgeBase.tsx` | 恢复选中 KB/page/query 和编辑草稿 |
| `ui/src/pages/EventCenter.tsx` | 恢复 tab/selected event，读取项目缓存 |
| `ui/src/pages/AgentMemory.tsx` | 恢复选中 Agent/dimension，读取复合 scope 缓存 |
| `ui/src/pages/Schedule.tsx` | 读取 rules 项目缓存 |
| `ui/src/pages/AgentSquare.tsx` | 部署后跳转使用项目导航 helper |
| `ui/src/components/global-assistant/GlobalAssistantDrawer.tsx` | 保持全局跳转，禁止误加项目前缀 |
| `README.md` | 说明 PC 项目 Tab 可恢复路径和缓存状态 |
| `docs/architecture/overview.md` | 增加 PC 项目路由、缓存和 view-state 边界 |

## 4. 实施任务

### Task 1：建立路由与路径记忆纯函数

**Files:**
- Create: `ui/src/routing/project-routes.ts`
- Test: `tests/unit/project-routes.test.ts`

- [ ] **Step 1：写失败测试，覆盖路径识别、拼接、损坏存储和默认回退**

```ts
import { beforeEach, describe, expect, test } from 'vitest'
import {
  buildProjectPath,
  normalizeProjectLocation,
  readLastProjectLocation,
  rememberProjectLocation,
} from '../../ui/src/routing/project-routes.ts'

describe('project route memory', () => {
  let storage: Storage

  beforeEach(() => {
    const values = new Map<string, string>()
    storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => { values.delete(key) },
      setItem: (key, value) => { values.set(key, value) },
    }
  })

  test('restores pathname, search and hash for each project', () => {
    rememberProjectLocation('project-a', {
      pathname: '/tasks',
      search: '?status=running',
      hash: '#today',
    }, storage)
    expect(readLastProjectLocation('project-a', storage)).toEqual({
      pathname: '/tasks',
      search: '?status=running',
      hash: '#today',
    })
    expect(buildProjectPath('project-a', readLastProjectLocation('project-a', storage)))
      .toBe('/p/project-a/tasks?status=running#today')
  })

  test('rejects global and malformed remembered paths', () => {
    expect(normalizeProjectLocation({ pathname: '/settings', search: '', hash: '' }))
      .toEqual({ pathname: '/workspace', search: '', hash: '' })
  })
})
```

- [ ] **Step 2：运行测试并确认失败**

Run: `npx vitest run tests/unit/project-routes.test.ts`

Expected: FAIL，提示 `project-routes.ts` 不存在或导出缺失。

- [ ] **Step 3：实现纯函数 API**

```ts
export const PROJECT_LOCATION_STORAGE_KEY = 'ai-ide-project-last-locations-v1'
export const DEFAULT_PROJECT_LOCATION: ProjectLocation = {
  pathname: '/workspace',
  search: '',
  hash: '',
}

export function isProjectPath(pathname: string): boolean
export function stripProjectPrefix(pathname: string, projectId: string): string
export function buildProjectPath(projectId: string, location: ProjectLocation | null): string
export function normalizeProjectLocation(location: ProjectLocation): ProjectLocation
export function readLastProjectLocation(projectId: string, storage?: Storage | null): ProjectLocation
export function rememberProjectLocation(projectId: string, location: ProjectLocation, storage?: Storage | null): void
export function removeProjectLocation(projectId: string, storage?: Storage | null): void
```

实现要求：所有 localStorage 读写包在 `try/catch`；projectId 使用 `encodeURIComponent`；只保存项目子路径；存储对象加版本后缀，未来可迁移。

- [ ] **Step 4：运行目标测试**

Run: `npx vitest run tests/unit/project-routes.test.ts`

Expected: PASS。

- [ ] **Step 5：提交原子变更**

```bash
git add ui/src/routing/project-routes.ts tests/unit/project-routes.test.ts
git commit -m "feat(ui): add project route memory helpers"
```

### Task 2：重构项目路由树并统一切换入口

**Files:**
- Create: `ui/src/hooks/use-project-navigation.ts`
- Create: `ui/src/hooks/use-project-scope.ts`
- Create: `ui/src/components/project/ProjectScopeLayout.tsx`
- Create: `ui/src/components/project/LegacyProjectRedirect.tsx`
- Create: `ui/src/components/layout/ProjectSwitcher.tsx`
- Create: `ui/src/components/layout/ProjectTabBar.tsx`
- Modify: `ui/src/App.tsx:85`
- Modify: `ui/src/components/layout/AppLayout.tsx:35`
- Modify: `ui/src/stores/project.store.ts:38`

- [ ] **Step 1：为项目 store 增加 `initialized` 并补单元测试**

`fetchProjects()` 完成后设置 `initialized=true`；请求失败也必须结束初始化状态并保留错误，路由 guard 才能区分“尚未验证”和“项目不存在”。删除项目时调用 `removeProjectLocation(id)`。

- [ ] **Step 2：实现统一切换 hook**

```ts
interface ProjectNavigation {
  switchProject: (projectId: string) => void
  toProjectPath: (subpath: string) => string
  navigateInProject: (subpath: string, options?: NavigateOptions) => void
}

export function useProjectNavigation(): ProjectNavigation
```

`switchProject` 流程固定为：记录当前项目位置 → 读取目标项目位置 → `navigate(targetPath)`。不要在旧页面仍挂载时先调用 `selectProject(target)`；由目标 `ProjectScopeLayout` 在浏览器绘制前同步 store，避免旧页面 effect 抢先加载新项目。仅当当前 URL 已处于目标项目路径时不跳转；从全局页点击当前项目 Tab 仍应打开该项目上次位置。

- [ ] **Step 3：实现 route scope context**

```ts
export interface ProjectScopeContextValue {
  projectId: string
}

export function useProjectScope(): ProjectScopeContextValue
export function useProjectScopeId(): string
```

所有项目页的数据请求、cache selector 和 view-state key 使用 `useProjectScopeId()`，`currentProjectId` 只保留给顶栏、全局助理等全局 UI 显示当前上下文。

- [ ] **Step 4：拆分 `AppLayout.tsx`**

把 `ProjectSwitcher`、`ProjectTabBar` 及其键盘监听迁到独立文件；两个组件都调用 `useProjectNavigation().switchProject`，不再直接调用 `selectProject`。拆分后 `AppLayout.tsx` 控制在 300 行以内。

- [ ] **Step 5：建立项目路由树**

```tsx
<Route element={<AppLayout />}>
  <Route path="/" element={<Dashboard />} />
  {/* global routes remain unchanged */}

  <Route path="/p/:projectId" element={<ProjectScopeLayout />}>
    <Route index element={<Navigate to="workspace" replace />} />
    <Route path="workspace" element={<Workspace />} />
    <Route path="tasks" element={<TaskBoard />} />
    <Route path="tasks/modes" element={<TaskModesSettings />} />
    <Route path="schedule" element={<Schedule />} />
    <Route path="events" element={<EventCenter />} />
    <Route path="knowledge" element={<KnowledgeBase />} />
    <Route path="agent-memory" element={<AgentMemory />} />
  </Route>

  <Route path="/workspace" element={<LegacyProjectRedirect subpath="/workspace" />} />
  <Route path="/tasks" element={<LegacyProjectRedirect subpath="/tasks" />} />
</Route>
```

所有七个旧项目路径都提供 redirect；`/share/:token`、`/widget` 继续放在 `AppLayout` 外。

- [ ] **Step 6：实现 `ProjectScopeLayout`**

行为顺序：等待项目 store 初始化 → 校验 projectId → 在 `useLayoutEffect` 同步 `selectProject(projectId)` 和激活数据 scope → 用 `<Outlet key={projectId} context={{ projectId }} />` 渲染项目页 → location 变化时记录最后项目子路径。非法 ID 使用 `replace` 跳转 `/projects?error=project-not-found`。

- [ ] **Step 7：替换硬编码项目跳转**

修改以下位置：

- `ui/src/pages/KnowledgeBase.tsx:147`：刷新会话后跳项目 Workspace。
- `ui/src/pages/AgentSquare.tsx:139`：部署后跳目标项目 Workspace。
- `ui/src/pages/TaskBoard.tsx:68`：移除 `window.location.hash`，用项目路由跳 Workspace/Task Modes。
- `ui/src/components/layout/AppLayout.tsx:42`：项目导航由 helper 拼接前缀；全局导航保持原路径。

- [ ] **Step 8：运行路由测试、构建和 lint**

Run: `npx vitest run tests/unit/project-routes.test.ts`

Run: `npm run build -w ui`

Run: `npm run lint -w ui`

Expected: 全部退出码 0。

- [ ] **Step 9：提交路由阶段**

```bash
git add ui/src/App.tsx ui/src/hooks/use-project-navigation.ts ui/src/hooks/use-project-scope.ts ui/src/components/project/ProjectScopeLayout.tsx ui/src/components/project/LegacyProjectRedirect.tsx ui/src/components/layout/AppLayout.tsx ui/src/components/layout/ProjectSwitcher.tsx ui/src/components/layout/ProjectTabBar.tsx ui/src/stores/project.store.ts ui/src/pages/KnowledgeBase.tsx ui/src/pages/AgentSquare.tsx ui/src/pages/TaskBoard.tsx
git commit -m "feat(ui): scope project pages by route"
```

### Task 3：实现通用项目缓存状态机

**Files:**
- Create: `ui/src/stores/project-cache.ts`
- Test: `tests/unit/project-cache.test.ts`

- [ ] **Step 1：写失败测试**

覆盖：scope key、30 秒 TTL、invalidated、每 scope request sequence、局部 patch、删除、LRU 保留活动项目和 `__all__`。

```ts
test('accepts only the latest response for each scope', () => {
  let state = emptyProjectCache<string[]>([])
  const a1 = beginProjectRequest(state, 'a')
  state = a1.state
  const a2 = beginProjectRequest(state, 'a')
  state = a2.state
  expect(canCommitProjectResponse(state, 'a', a1.requestSeq)).toBe(false)
  expect(canCommitProjectResponse(state, 'a', a2.requestSeq)).toBe(true)
})
```

- [ ] **Step 2：运行并确认失败**

Run: `npx vitest run tests/unit/project-cache.test.ts`

Expected: FAIL，导出不存在。

- [ ] **Step 3：实现纯函数**

```ts
export const ALL_PROJECTS_SCOPE = '__all__'
export const PROJECT_CACHE_TTL_MS = 30_000
export const MAX_PROJECT_CACHE_ENTRIES = 5

export interface BeginRequestResult<T> {
  state: ProjectCacheState<T>
  requestSeq: number
}

export interface CommitInput<T> {
  scope: string
  requestSeq: number
  data: T
  now?: number
}

export function emptyProjectCache<T>(initialData: T): ProjectCacheState<T>
export function projectScopeKey(projectId?: string | null): string
export function readProjectCache<T>(state: ProjectCacheState<T>, scope: string): ProjectCacheEntry<T> | null
export function shouldRefreshProjectCache<T>(entry: ProjectCacheEntry<T> | null, now?: number): boolean
export function beginProjectRequest<T>(state: ProjectCacheState<T>, scope: string): BeginRequestResult<T>
export function canCommitProjectResponse<T>(state: ProjectCacheState<T>, scope: string, requestSeq: number): boolean
export function commitProjectResponse<T>(state: ProjectCacheState<T>, input: CommitInput<T>): ProjectCacheState<T>
export function patchCachedArrays<T extends { id: string }>(state: ProjectCacheState<T[]>, id: string, patch: Partial<T>): ProjectCacheState<T[]>
export function removeCachedArrayItem<T extends { id: string }>(state: ProjectCacheState<T[]>, id: string): ProjectCacheState<T[]>
export function pruneProjectCache<T>(state: ProjectCacheState<T>, activeScope: string): ProjectCacheState<T>
```

所有函数返回新对象，不原地修改 `Map` 或缓存数组，保证 Zustand selector 能收到引用变化。

每个执行 RPC 的 store 另维护模块内 `Map<string, Promise<void>>` 复用同 scope 的普通刷新请求，并在 `finally` 删除；`force=true` 可以启动新 sequence，旧响应由 `canCommitProjectResponse` 拒绝。Promise 不放入 Zustand state，避免不可序列化状态进入 devtools/persist。

- [ ] **Step 4：运行测试并提交**

Run: `npx vitest run tests/unit/project-cache.test.ts`

Expected: PASS。

```bash
git add ui/src/stores/project-cache.ts tests/unit/project-cache.test.ts
git commit -m "feat(ui): add project cache state machine"
```

### Task 4：改造 Task 和 Agent 核心缓存

**Files:**
- Modify: `ui/src/stores/task.store.ts:86`
- Modify: `ui/src/stores/agent.store.ts:31`
- Test: `tests/unit/task-project-cache.test.ts`
- Test: `tests/unit/agent-project-cache.test.ts`

- [ ] **Step 1：为 Task 写切换、SWR、乱序和 WS 跨项目失败测试**

测试序列：加载 A → 激活 B 并加载 → 再激活 A，断言 A 数据同步恢复且不清空；发送 B 的 `task:update` 时 A 视图不变但 B cache 被更新；A 的旧响应晚于新响应时被忽略。

- [ ] **Step 2：扩展 Task store 公开接口**

```ts
interface TaskStore {
  tasks: TaskData[]
  modes: TaskExecutionModeData[]
  activeScope: string
  taskCache: ProjectCacheState<TaskData[]>
  modeCache: ProjectCacheState<TaskExecutionModeData[]>
  loading: boolean
  refreshing: boolean
  activateProject: (projectId?: string | null) => void
  fetchTasks: (projectId?: string, options?: { force?: boolean }) => Promise<void>
  invalidateProject: (projectId?: string | null) => void
  clearProjectCache: (projectId: string) => void
}
```

`tasks`、`modes` 暂时保留为活动 scope 的兼容投影，避免一次修改所有消费组件。`activateProject` 必须同步从 cache 恢复投影。

- [ ] **Step 3：重写 `task:update` listener**

删除当前 `taskProjectId !== currentProjectId` 的 early return。完整 Task 合并到 project scope 和 `__all__`；partial patch 更新所有命中 scope；deleted 从所有 scope 移除。

- [ ] **Step 4：按相同状态机改 Agent store**

`agent:status` 按 agent ID patch 所有命中缓存；创建、部署、更新、删除和排序操作只改实体所属项目缓存，同时保持 `__all__` 一致。

- [ ] **Step 5：运行目标测试**

Run: `npx vitest run tests/unit/project-cache.test.ts tests/unit/task-project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/task-store.test.ts`

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add ui/src/stores/task.store.ts ui/src/stores/agent.store.ts tests/unit/task-project-cache.test.ts tests/unit/agent-project-cache.test.ts
git commit -m "feat(ui): cache tasks and agents by project"
```

### Task 5：改造 Session 列表缓存，保留消息缓存

**Files:**
- Create: `ui/src/stores/session-list-cache.ts`
- Modify: `ui/src/stores/session.store.ts:245`
- Test: `tests/unit/session-project-cache.test.ts`
- Modify Test: `tests/unit/session-store-done-refresh.test.ts`

- [ ] **Step 1：先写 Session 专项失败测试**

至少覆盖：

- A/B session list 独立缓存和同步激活。
- `fetchSessions(undefined, A)` 与 `fetchSessions(undefined, B)` 并发乱序。
- 查看 A 时收到 B 的完整 `session:changed`，B cache 更新、A 投影不变。
- partial `last_read_at`、stage patch 更新所有命中 scope。
- delete 从所有 scope、未读、运行中和 `sessionCaches` 清理。
- 切回 session 时仍从现有 `sessionCaches` 即时恢复消息。

- [ ] **Step 2：提取列表缓存 reducer**

```ts
export interface SessionListCacheState {
  cache: ProjectCacheState<SessionData[]>
  activeScope: string
}

export function activateSessionList(state: SessionListCacheState, projectId?: string | null): ActivateResult
export function commitSessionList(state: SessionListCacheState, input: CommitSessionListInput): SessionListCacheState
export function mergeSessionChanged(state: SessionListCacheState, sessionId: string, data: Partial<SessionData>): SessionListCacheState
export function removeSessionFromLists(state: SessionListCacheState, sessionId: string): SessionListCacheState
```

纯函数放入新文件，把 `session.store.ts` 中与列表 cache 无关的消息、事件、流式输出逻辑留在原处。

- [ ] **Step 3：替换全局 `sessionListRequestSeq` 和 `activeSessionsProjectId`**

改为逐 scope sequence；保留 `sessions` 为活动 scope 投影。`fetchSessions` 有缓存时不设置 `loading=true`，只设置 `refreshing=true`。

- [ ] **Step 4：保持 per-session 消息缓存边界**

`sessionCaches` 仍以 sessionId 为 key；`selectSession` 切换时先恢复 cache，再后台 `fetchMessages`。现有 `readProjectLastSession` / `writeProjectLastSession` 继续负责每项目当前会话，不再创建重复机制。

- [ ] **Step 5：改造 `session:changed` listener**

完整行按 `project_id` 合并；局部 patch 更新所有包含 sessionId 的 scope；删除从全部 scope 清理。`session:activity`、`session:done` 不直接触发多次全量列表刷新，只 invalidate 命中 scope，并沿用现有 debounce 刷新当前 scope。

- [ ] **Step 6：运行 Session 回归**

Run: `npx vitest run tests/unit/session-project-cache.test.ts tests/unit/session-store-done-refresh.test.ts tests/unit/workspace-project-filters.test.ts`

Expected: PASS；原有消息流、复制会话、未读和完成刷新测试不回归。

- [ ] **Step 7：提交**

```bash
git add ui/src/stores/session-list-cache.ts ui/src/stores/session.store.ts tests/unit/session-project-cache.test.ts tests/unit/session-store-done-refresh.test.ts
git commit -m "feat(ui): cache session lists by project"
```

### Task 6：在项目 layout 激活核心数据并消除重复加载感

**Files:**
- Create: `ui/src/project-scope/project-data-scope.ts`
- Modify: `ui/src/components/project/ProjectScopeLayout.tsx`
- Modify: `ui/src/App.tsx:46`
- Modify: `ui/src/pages/Workspace.tsx:504`
- Modify: `ui/src/pages/TaskBoard.tsx:43`
- Modify: `ui/src/pages/TaskModesSettings.tsx:17`

- [ ] **Step 1：实现公开适配层**

```ts
export function activateProjectData(projectId: string): void {
  useAgentStore.getState().activateProject(projectId)
  useSessionStore.getState().activateProject(projectId)
  useTaskStore.getState().activateProject(projectId)
}

export function refreshProjectData(projectId: string, options?: { force?: boolean }): void
export function clearProjectData(projectId: string): void
```

该文件是唯一允许同时编排多个公开 store action 的适配层；页面不直接批量调用多个 `getState()`。

- [ ] **Step 2：layout 在浏览器绘制前激活 cache**

`ProjectScopeLayout` 的 `useLayoutEffect` 先 `activateProjectData(projectId)`，随后发起非阻塞 `refreshProjectData(projectId)`。首次无缓存时渲染现有 loading；已有缓存时直接渲染页面。

- [ ] **Step 3：移除 Workspace/TaskBoard 的重复清空式加载**

页面 effect 只调用具备去重和 TTL 的 `refreshProjectData` 或单资源 `fetch`。同一 project + 同一 in-flight request 必须复用 promise，避免 App bootstrap、layout、页面三处同时请求。

- [ ] **Step 4：调整 App bootstrap**

连接建立后仍初始化全局项目、规则、模板、工具等；项目实体列表由 route layout 按 URL 项目启动，不再仅依据 localStorage 的旧 `currentProjectId` 抢先覆盖。

- [ ] **Step 5：运行构建和核心测试**

Run: `npx vitest run tests/unit/project-routes.test.ts tests/unit/task-project-cache.test.ts tests/unit/agent-project-cache.test.ts tests/unit/session-project-cache.test.ts`

Run: `npm run build -w ui`

Expected: PASS。

- [ ] **Step 6：提交 MVP 数据阶段**

```bash
git add ui/src/project-scope/project-data-scope.ts ui/src/components/project/ProjectScopeLayout.tsx ui/src/App.tsx ui/src/pages/Workspace.tsx ui/src/pages/TaskBoard.tsx ui/src/pages/TaskModesSettings.tsx
git commit -m "feat(ui): activate cached project data on route switch"
```

### Task 7：保存 Workspace 和 TaskBoard 关键视图状态

**Files:**
- Create: `ui/src/stores/project-view-state.store.ts`
- Create: `ui/src/pages/workspace/use-workspace-project-state.ts`
- Test: `tests/unit/project-view-state.test.ts`
- Modify: `ui/src/pages/Workspace.tsx:137`
- Modify: `ui/src/pages/TaskBoard.tsx:29`

- [ ] **Step 1：写 view-state reducer 测试**

验证 A/B 更新互不影响、patch 不覆盖同项目其他页面状态、删除项目清理、损坏 localStorage 回退空状态。

- [ ] **Step 2：实现小粒度 action**

```ts
interface ProjectViewStateStore {
  byProjectId: Record<string, ProjectViewState>
  patchWorkspace: (projectId: string, patch: Partial<WorkspaceViewState>) => void
  patchTasks: (projectId: string, patch: Partial<TaskBoardViewState>) => void
  patchKnowledge: (projectId: string, patch: Partial<KnowledgeViewState>) => void
  patchEvents: (projectId: string, patch: Partial<EventCenterViewState>) => void
  patchAgentMemory: (projectId: string, patch: Partial<AgentMemoryViewState>) => void
  clearProject: (projectId: string) => void
}
```

只把选中 ID、tab、筛选和查询持久化到 localStorage；滚动位置只保存在内存，避免高频写 localStorage。

- [ ] **Step 3：接入 Workspace**

把 `sidebarTab`、`selectedAgentId` 和各面板 scrollTop 的恢复逻辑放进 `use-workspace-project-state.ts`，Workspace 只消费 hook 返回值，不继续追加状态编排代码；变化时 patch route projectId。当前 session 继续由 session store 的项目映射恢复；聊天草稿继续用 session draft helper。

- [ ] **Step 4：接入 TaskBoard**

恢复 `selectedTaskId` 和滚动位置。若缓存刷新后该任务已删除，清空选中项。任务状态筛选同步到 URL search params，保证路径记忆和分享链接一致。

- [ ] **Step 5：运行测试和构建**

Run: `npx vitest run tests/unit/project-view-state.test.ts tests/unit/workspace-session-drafts.test.ts tests/unit/workspace-project-filters.test.ts`

Run: `npm run build -w ui`

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add ui/src/stores/project-view-state.store.ts ui/src/pages/workspace/use-workspace-project-state.ts ui/src/pages/Workspace.tsx ui/src/pages/TaskBoard.tsx tests/unit/project-view-state.test.ts
git commit -m "feat(ui): restore project workspace and task view state"
```

### Task 8：扩展文件、知识库、规则、事件和 Agent 记忆缓存

**Files:**
- Modify: `ui/src/stores/filesystem.store.ts`
- Modify: `ui/src/stores/knowledge-base.store.ts`
- Modify: `ui/src/stores/rule.store.ts`
- Modify: `ui/src/stores/event-center.store.ts`
- Modify: `ui/src/stores/agent-memory.store.ts`
- Modify: `ui/src/pages/KnowledgeBase.tsx`
- Modify: `ui/src/pages/EventCenter.tsx`
- Modify: `ui/src/pages/Schedule.tsx`
- Modify: `ui/src/pages/AgentMemory.tsx`
- Test: `tests/unit/project-secondary-cache.test.ts`

- [ ] **Step 1：先为每类资源写最小失败用例**

每类至少验证：A/B 独立、切回同步恢复、有 cache 不清空、WS/invalidate 不刷新非活动页。文件树额外验证 A 的展开目录不出现在 B；知识库额外验证 currentKb/currentPage 和 dirty draft 独立。

- [ ] **Step 2：改造 filesystem store**

按 projectId 保存 `tree`、`openFile`、`expandedPaths` 和 fetchedAt。打开文件响应必须校验 projectId/path request token，防止切换后旧响应覆盖新项目编辑区。

- [ ] **Step 3：改造 knowledge-base store**

项目分区内容包括 `knowledgeBases`、`pagesByKbId`、`currentKbId`、`currentPageId`、`currentRead`、`activities`、`searchResults`。`sharedKnowledgeBases` 保持全局缓存。`knowledge-base:update` 有 projectId 时只 invalidate 对应项目；缺失时 invalidate 已访问项目但只刷新活动项目。

- [ ] **Step 4：处理知识库未保存草稿**

在 view-state 增加 `draftByPageKey`，key 为 `${projectId}:${pageId}`。切项目时保存表单；切回恢复；保存成功后删除草稿。远端更新到达 dirty 页面时继续沿用 `remoteUpdatePending`，不得覆盖本地草稿。

- [ ] **Step 5：改造 rule/event-center/agent-memory store**

- Rule：按 project/`__all__` 缓存规则和执行模式，partial update 跨命中 scope patch。
- Event Center：按 project 保存 categories/events/subscriptions/details/filter/selectedEvent；集合更新只 invalidate。
- Agent Memory：dimensions scope 为 `projectId:agentId`，entries scope 为 `projectId:agentId:dimension`；切回时恢复 selected agent/dimension。

- [ ] **Step 6：接入对应页面 view-state**

Event Center 恢复 tab/selectedEvent；Knowledge Base 恢复 KB/page/query；Agent Memory 恢复 Agent/dimension；Schedule 直接读取活动 rules cache。

- [ ] **Step 7：运行次要页面测试、全 UI 构建**

Run: `npx vitest run tests/unit/project-secondary-cache.test.ts tests/unit/knowledge-base-service.test.ts tests/unit/event-center-service.test.ts`

Run: `npm run build -w ui`

Expected: PASS。

- [ ] **Step 8：提交**

```bash
git add ui/src/stores/filesystem.store.ts ui/src/stores/knowledge-base.store.ts ui/src/stores/rule.store.ts ui/src/stores/event-center.store.ts ui/src/stores/agent-memory.store.ts ui/src/pages/KnowledgeBase.tsx ui/src/pages/EventCenter.tsx ui/src/pages/Schedule.tsx ui/src/pages/AgentMemory.tsx tests/unit/project-secondary-cache.test.ts
git commit -m "feat(ui): cache secondary project resources"
```

### Task 9：缓存生命周期、删除项目和重连策略

**Files:**
- Modify: `ui/src/project-scope/project-data-scope.ts`
- Modify: `ui/src/stores/project.store.ts`
- Modify: `ui/src/stores/connection.store.ts`
- Modify: `ui/src/App.tsx`
- Test: `tests/unit/project-cache-lifecycle.test.ts`

- [ ] **Step 1：写生命周期失败测试**

覆盖：访问第 6 个项目淘汰最久未用缓存；活动项目不淘汰；删除项目清理所有 store 和路径/view-state；断线不清 cache；重连后立即显示 cache 并强制刷新活动项目一次。

- [ ] **Step 2：扩展项目 scope 适配层**

```ts
export function invalidateProjectData(projectId: string): void
export function clearProjectData(projectId: string): void
export function reconcileProjectData(validProjectIds: string[]): void
```

所有操作只调用各 store 的公开 action，不直接修改其内部状态。

- [ ] **Step 3：接入删除与项目列表刷新**

项目删除成功后清路径记忆、view-state、所有资源缓存和 per-project last session 映射。`fetchProjects` 返回后 reconcile 已删除项目，覆盖多端删除场景。

- [ ] **Step 4：接入连接恢复**

`connection` 从 false→true 时 invalidate 当前 URL 项目并强制刷新一次；保留缓存作为首帧，不在断线时清空。

- [ ] **Step 5：运行生命周期测试**

Run: `npx vitest run tests/unit/project-cache-lifecycle.test.ts tests/unit/project-cache.test.ts`

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add ui/src/project-scope/project-data-scope.ts ui/src/stores/project.store.ts ui/src/stores/connection.store.ts ui/src/App.tsx tests/unit/project-cache-lifecycle.test.ts
git commit -m "feat(ui): manage project cache lifecycle"
```

### Task 10：文档、回归和人工验收

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/superpowers/plans/2026-07-17-pc-project-switching-isolation.md`

- [ ] **Step 1：更新架构总览**

只描述稳定目标结构：URL 项目边界、project scope adapter、Zustand cache、WebSocket cache update、view-state 边界。不要把实施阶段或任务清单复制到架构文档。

- [ ] **Step 2：更新 README**

在 PC 项目切换功能处说明：固定 Tab、恢复上次项目页面、缓存首显、后台同步。用户可见文本使用中文。

- [ ] **Step 3：运行完整自动验证**

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected:

- Vitest 所有测试通过。
- server、PC UI、mobile build 全部退出码 0。
- ESLint 无新增错误。
- `git diff --check` 无输出。

- [ ] **Step 4：启动本地服务并执行人工矩阵**

Run: `npm run dev:all`

人工验证：

1. 准备 A/B 两个项目并各固定 Tab。
2. A 打开任务页、筛选进行中、选中任务并滚动。
3. B 打开 Workspace、选中会话、切到文件侧栏并展开目录。
4. 连续 A↔B 十次，确认路径、选中项、滚动和文件树互不串。
5. 断开再恢复 WebSocket，确认旧内容保留且恢复后静默刷新。
6. 在另一窗口修改 B 任务，当前停留 A，切回 B 确认缓存已经更新或立即后台刷新。
7. 刷新 `/p/B/workspace`、打开旧 `/workspace`、打开非法 `/p/missing/tasks`。
8. 检查 `/share/:token`、`/widget`、Dashboard、Settings 未被项目前缀影响。

- [ ] **Step 5：记录实测指标**

在本计划末尾追加实际结果：冷切换耗时、热切换首帧耗时、每个 store 缓存项目数、完整测试数量。目标为热切换首帧小于 100ms，且不出现空数据闪烁。

- [ ] **Step 6：最终提交并请求代码评审**

```bash
git add README.md docs/architecture/overview.md docs/superpowers/plans/2026-07-17-pc-project-switching-isolation.md
git commit -m "docs: document isolated project switching"
```

## 5. 分阶段交付与工期

| 阶段 | 包含任务 | 可独立验收结果 | 预估 |
|---|---|---|---:|
| A：路由记忆 | Task 1–2 | A/B 切回各自最后页面，旧路径兼容 | 2–3 人天 |
| B：核心缓存 MVP | Task 3–6 | Workspace/TaskBoard 热切换无空白，跨项目 task/session 更新正确 | 5–7 人天 |
| C：关键 view-state | Task 7 | 选中项、侧栏、筛选、滚动恢复 | 2–3 人天 |
| D：完整项目页 | Task 8–9 | 文件、知识库、规则、事件、记忆均隔离缓存 | 3–5 人天 |
| E：回归与文档 | Task 10 | 全量验证、人工矩阵、文档完成 | 1–2 人天 |
| **总计** |  | 单人完整 PC 版 | **13–20 人天** |

MVP 建议在阶段 B 后先发布，预计 7–10 人天即可覆盖主要加载痛点。阶段 C/D 继续补足“完全像独立项目 Tab”的体验。若实施中发现 WebSocket 某类新增实体事件不含完整实体或 projectId，应单独增加协议修复任务并更新 `src/types/ws-protocol.ts`、`docs/architecture/ws-protocol.md`；不要在前端用当前项目猜测归属。

## 6. 风险与回滚边界

| 风险 | 控制措施 | 回滚边界 |
|---|---|---|
| Route 与 store 项目短暂不一致 | URL 真源；layout 验证后才渲染；useLayoutEffect 激活缓存 | 可回滚 Task 2，旧路径 redirect 保留 |
| Session store 回归 | 只提取列表缓存；消息/流式 reducer 不迁移；完整 Session 测试回归 | Task 5 独立提交 |
| 在途响应串项目 | 每 scope request sequence；响应提交前校验 scope+seq | project-cache helper 单点修复 |
| WS 更新遗漏后台项目 | 完整实体定向更新、partial 跨 cache patch、集合事件 invalidate | listener 按 store 独立回滚 |
| 内存增长 | 每 store 五项目 LRU；消息缓存沿用现状；删除项目清理 | 可调 `MAX_PROJECT_CACHE_ENTRIES` |
| dirty 编辑被覆盖 | Knowledge draft 按 project+page 保存；远端更新只标记 pending | Knowledge 阶段独立回滚 |
| 全局页被错误加前缀 | 项目路径白名单；全局导航保留绝对路径；旧路径测试 | 路由 helper 集中修复 |

## 7. 最终验收清单

- [ ] A/B 项目各自最后页面、query、hash 可恢复。
- [ ] Workspace 当前会话、侧栏、草稿和滚动不串项目。
- [ ] TaskBoard 选中项、筛选和滚动不串项目。
- [ ] 已缓存项目切回不出现空列表或全屏 loading。
- [ ] 缓存超过 TTL、重连、写操作后后台刷新。
- [ ] Task/Session/Agent 的后台项目 WS 更新正确。
- [ ] 文件树、知识库、规则、事件、Agent 记忆缓存按项目隔离。
- [ ] 非法/删除项目、旧路径和直接深链行为明确。
- [ ] 全局页、分享页、Widget、移动端无回归。
- [ ] 新文件均符合命名、named export 和文件大小约束。
- [ ] `npm test`、`npm run build`、`npm run lint`、`git diff --check` 全部通过。

## 8. 实施与验收结果（2026-07-17）

- 路由恢复：使用两个真实项目验证 A 为 `/tasks?status=running#focus`、B 为 `/knowledge?query=cache#doc`，通过顶部切换器和固定 Tab 往返后均恢复各自完整 pathname、query 与 hash。
- 切换性能：Chrome 无头模式下，以点击目标项目到连续两个 `requestAnimationFrame` 为首帧口径，冷切换 73ms，已缓存项目热切换 74ms；切换过程未出现空数据闪烁。
- 布局：1440×900 与 900×700 两个 PC 视口均无顶部控件重叠、无文档级横向溢出；任务看板在窄视口保持自身横向滚动边界。
- 兼容路径：旧 `/workspace` 会重定向到当前有效项目；非法 `/p/project-does-not-exist/tasks` 会重定向到 `/projects?error=project-not-found`。
- 缓存上限：通用项目缓存和各业务 store 均采用最多 5 个项目的 LRU，TTL 为 30 秒；Session 消息与流式状态继续按 `sessionId` 保存。
- 自动验证：`npm test` 通过 180 个测试文件、973 个测试；`npm run build`、`npm run lint` 与 `git diff --check` 均通过。
