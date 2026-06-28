# AI IDE Studio 架构审查报告

> 审查日期：2026-06-02 | 版本：v0.2.0 | 范围：全栈（后端 + 前端 + 测试 + 文档）

---

## 一、项目概况

| 维度 | 数据 |
|------|------|
| 后端代码 | ~90 个 TypeScript 文件，~12,500 行 |
| 前端代码 | ~45 个 TS/TSX 文件，~9,000 行 |
| 测试文件 | 60 个（unit ~42 / integration ~18） |
| 文档文件 | ~76 个 markdown |
| 数据库迁移 | 6 个版本（001–006） |
| 依赖 | ACP SDK + MCP SDK + Hono + ws + better-sqlite3 + Zustand + React 19 |

---

## 二、架构分层评估

### 2.1 后端分层（整体良好 ⭐⭐⭐⭐）

```
┌─────────────────────────────────────────────────────┐
│  entry.ts / app.ts                    [启动层]       │
├─────────────────────────────────────────────────────┤
│  gateway/  (HTTP + WS + rpc/)         [网关层]       │
├─────────────────────────────────────────────────────┤
│  core/  (sessions, tasks, teams, rules) [业务层]     │
├──────────────┬──────────────────────────────────────┤
│  acp/        │  tools/                [协议/工具层]   │
├──────────────┴──────────────────────────────────────┤
│  store/  (SQLite CRUD)                [持久层]       │
├─────────────────────────────────────────────────────┤
│  types/  (ws-protocol.ts)             [类型层]       │
└─────────────────────────────────────────────────────┘
```

**优点**：
- 层级清晰，store 层仅依赖 db + logger，不反向依赖 core 层
- 无运行时循环依赖
- 事件总线（mitt）实现了 core ↔ gateway 的解耦
- RPC 按领域拆文件（sessions.ts / agents.ts / tools.ts 等），职责单一

**问题**：
- `core/sessions.ts` 同时承担会话管理和消息持久化，职责偏重（295 行，含 3 个 `events.on` 监听器）
- `core/teams.ts` 过于庞大（348 行），混合了团队 CRUD、成员调度、消息分发

### 2.2 前端分层（中等偏弱 ⭐⭐⭐）

```
┌────────────────────────────────────────┐
│  App.tsx → 路由                         │
├────────────────────────────────────────┤
│  pages/  (8 个页面)                     │  ← 此层问题最大
├────────────────────────────────────────┤
│  components/  (chat, layout, team...)  │
├────────────────────────────────────────┤
│  stores/  (14 个 Zustand store)        │  ← 设计良好
├────────────────────────────────────────┤
│  services/  (ws-client)                │
└────────────────────────────────────────┘
```

**优点**：
- Store 按领域独立拆分，彼此无直接 import
- `session-events.ts`（700 行纯函数）从 store 抽出归约逻辑，可测试性好
- WebSocket 单例 + RPC/PubSub 模式干净

**问题**：
- `Workspace.tsx` 达 **3093 行**，是 AGENTS.md 规定上限（300 行）的 10 倍
- 前端缺少 UI 组件测试和 E2E 测试

---

## 三、耦合度分析

### 3.1 模块间依赖热力图

| 被依赖模块 ↓ / 依赖方 → | gateway | core | acp | tools | store |
|-------------------------|---------|------|-----|-------|-------|
| **types/ws-protocol** | ✅ | ✅ | ✅ | ✅ | ⚪ |
| **core/events** | ✅ | ✅ | ✅ | ⚪ | ⚪ |
| **store/*** | ✅ | ✅ | ✅ | ✅ | — |
| **acp/host** | ⚪ | ✅ | — | ⚪ | ⚪ |
| **core/sessions** | ✅ | ⚪ | ⚪ | ✅ | ⚪ |

### 3.2 耦合度评级

| 维度 | 评级 | 说明 |
|------|------|------|
| **store → 外部** | 🟢 极低 | 仅依赖 db + logger，完全隔离 |
| **types → 外部** | 🟢 无依赖 | 纯类型定义 |
| **acp ↔ core** | 🟡 中等 | `core/sessions` → `acp/host`（prompt 调用），`acp/client-handler` → `core/events`（事件发射），存在双向依赖但通过事件总线松耦合 |
| **tools → core** | 🟡 中等 | `tools/handlers/core/*` 直接调用 `core/sessions`、`core/agents`，内置工具与业务层紧耦合 |
| **gateway → 全部** | 🟠 偏高 | RPC handlers 直接引用 `acp/host` + `core/*` + `store/*`，网关层穿透性强 |
| **前端 Workspace → stores** | 🔴 过高 | 单组件订阅 **7 个 store 的 30+ 个 selector/action** |

### 3.3 关键耦合风险

1. **`gateway/rpc/sessions.ts`** 同时引用 `acp/host`、`core/sessions`、`store/sessions`、`store/projects`、`core/events`、`core/logger` — 6 个模块依赖，本应只依赖 core 层

2. **`tools/handlers/team/team-tools.ts`**（300 行，14 个 handler）直接调用 `core/teams` 的每个方法 — 这是合理的，但如果 team API 变化，tool handlers 全部受影响

3. **前端 `App.tsx`** 初始化时引入了 10 个 store — 虽然只做 fetch + listener setup，但属于隐式耦合

---

## 四、架构设计评估

### 4.1 设计模式使用

| 模式 | 应用位置 | 评价 |
|------|---------|------|
| **事件总线** | `core/events.ts`（mitt） | ✅ 有效解耦 core ↔ gateway |
| **Singleton Facade** | `acpHost`, `sessionManager`, `taskManager` | ✅ 简化调用方，但缺乏接口抽象 |
| **工厂模式** | `createClientHandler(agentId)` | ✅ 为每个 agent 创建独立的 ACP 回调 |
| **Promise Queue** | `activePrompts` Set + `beginTurn`/`endTurn` | ✅ 防止同会话并发 prompt |
| **迁移链** | `store/migrations/` 顺序版本 | ✅ 规范的 schema 演进 |
| **Token 作用域** | `tool_contexts` 表 + SHA-256 | ✅ 安全的 session 级工具授权 |
| **Reducer 下沉** | `session-events.ts` 纯函数 | ✅ 从 store 提取逻辑，可独立测试 |

### 4.2 核心设计决策评估

#### ✅ 良好决策

- **ACP 子进程隔离**：每个 Agent 独立进程（stdio NDJSON），崩溃不影响主进程
- **MCP 作为工具注入机制**：Agent 通过 MCP 获取工具，符合标准协议
- **SQLite + WAL**：单文件数据库适合本地 IDE 场景，WAL 保证并发读写
- **事件驱动持久化**：`session:update` → 实时存储到 SQLite events 表，断线重连可恢复
- **前端 sessionCaches Map**：切换会话时保留流式状态，回切不丢失

#### 🟡 有待商榷

- **全局事件总线 vs 直接调用**：部分事件（如 `session:changed`、`task:update`）payload 是 `Record<string, unknown>`，丢失了类型安全
- **RPC 无 Schema 校验**：所有 RPC handler 用 `msg.xxx as string` 手工类型断言，恶意或异常请求可导致运行时错误
- **单文件 ws-protocol.ts（432 行）**：所有 WS 类型集中一处，随功能增长可能膨胀

#### 🔴 需要改进

- **Workspace God Component**：3093 行单文件，内含 10+ 内联子组件，维护和 review 成本极高
- **双重错误路径**：prompt 失败时同时有 out-of-band WS error **和** `session:done` error，前端需处理两种信号
- **配置分散**：ACP 超时、日志级别、工具网关端口等 env 变量散落在各模块，非中心化管理

---

## 五、实现质量评估

### 5.1 代码规范遵守度

| 规范项（AGENTS.md） | 遵守情况 |
|---------------------|---------|
| 函数组件 + Hooks | ✅ 全部遵守 |
| 无 `any` 类型 | ✅ 全量扫描 0 处 `any` |
| 无 `console.log`（后端） | ✅ 仅 CLI 使用 console |
| 无 `@ts-ignore` | ✅ 全项目无使用 |
| CSS 变量 + 内联样式 | 🟡 内联样式过多，可维护性差 |
| 组件 300 行上限 | 🔴 Workspace 3093 行、ToolManager 862 行严重超标 |
| 中文 UI 文本 | ✅ 所有面向用户文本为中文 |

### 5.2 类型安全评估（⭐⭐⭐☆）

**强项**：
- `ws-protocol.ts` 定义了完整的 RPC/事件类型（432 行）
- `session-events.ts` 有丰富的前端领域类型（700 行）
- Zod 用于 MCP 工具输入校验

**弱项**：
- RPC dispatch 是 `Record<string, RpcHandler>`，无法在编译期校验 handler 覆盖率
- WS 客户端 handler 类型为 `(msg: Record<string, unknown>) => void`，事件 payload 完全无类型
- 前端 store 的 `wsClient.request()` 返回 `unknown`，每处都需 `as XxxData[]` 断言
- `ClientMessage` 用 `[key: string]: unknown` 索引签名，RPC 字段类型仅靠开发者自觉

### 5.3 错误处理评估（⭐⭐⭐⭐）

**强项**：
- WS handler 有统一 try/catch，所有未捕获错误都返回 `sendError`
- `sendPrompt` 失败会 emit `session:done` with `stopReason: 'error'`，前端能感知
- Agent 进程退出时强制 emit done（本次修复新增）
- 结构化日志 + 敏感字段脱敏

**弱项**：
- 前端 `fetchSessions`/`fetchMessages`/`fetchEvents` 的 catch 为空 `{}`，用户无法感知加载失败
- 前端用 `console.error` 处理模型/模式切换失败，应有 toast 提示

### 5.4 测试覆盖评估（⭐⭐⭐⭐）

| 领域 | 覆盖度 | 说明 |
|------|--------|------|
| ACP 协议 | ✅ 高 | cancel、lifecycle、permission、prompt 完成 |
| Session 流式 | ✅ 高 | reducer、finalize、merge、streaming buffer |
| 工具系统 | ✅ 高 | resolver、runtime、seed、profiles、gateway |
| 团队协作 | ✅ 中高 | store、dispatch、errors、tool handlers |
| 数据库迁移 | ✅ 中 | 全迁移应用测试，但无单版本回归 |
| UI 组件 | 🔴 无 | 无 React 组件测试 |
| E2E | 🔴 无 | 无端到端流程测试 |
| Auth | 🔴 无 | `AI_IDE_LOCAL_TOKEN` 守卫无测试 |

### 5.5 安全性评估（⭐⭐☆）

| 问题 | 严重度 | 说明 |
|------|--------|------|
| 默认无认证 | 🔴 | `AI_IDE_LOCAL_TOKEN` 未设时全开放，`0.0.0.0` 监听 |
| RPC 无输入校验 | 🟠 | 手工 `as string` 断言，异常 payload 导致运行时错误 |
| 无速率限制 | 🟡 | WS 和 HTTP 均无限速 |
| 路径遍历 | 🟢 | `readFile`/`expandDir` 已防护，`listDirectory` 需复查 |
| MCP 工具授权 | 🟢 | session 级 token + SHA-256 + TTL |

---

## 六、重点文件尺寸问题

| 文件 | 行数 | 严重度 | 建议 |
|------|------|--------|------|
| `ui/src/pages/Workspace.tsx` | **3093** | 🔴 | 拆分 8+ 内联组件到 `components/workspace/` |
| `ui/src/pages/ToolManager.tsx` | **862** | 🟠 | 拆为 ToolList / ToolForm / BindingPanel |
| `ui/src/stores/session-events.ts` | 700 | 🟡 | 纯函数，可接受，但可按职责拆文件 |
| `ui/src/stores/session.store.ts` | 616 | 🟡 | listener 段可拆到 `session-listeners.ts` |
| `src/acp/host.ts` | 629 | 🟡 | mock agent 部分可拆到 `mock-agent.ts`（部分已拆） |
| `src/types/ws-protocol.ts` | 432 | 🟡 | 随功能增长需按领域拆分 |

---

## 七、死代码 / 遗留问题

| 文件 | 问题 |
|------|------|
| `ui/src/components/chat/ChatView.tsx`（460 行） | 旧版暗色主题聊天 UI，无任何引用 |
| `ui/src/components/session/SessionTimeline.tsx`（295 行） | 旧版时间线组件，无任何引用 |
| `ui/src/types/index.ts`（113 行） | 早期 mock 类型，仅被上述两个死组件引用 |
| `docs/architecture/legacy-frontend-architecture.md` | 描述旧版 mock 前端，与当前代码不符 |
| `docs/architecture/pragmatic-plan.md` / `coding-plan.md` | 实现计划文档放在 architecture/ 下，应移到 `superpowers/plans/` |
| `docs/guides/testing.md` | 仅列 9 个测试文件，实际有 60 个 |

---

## 八、文档质量评估

| 类别 | 评级 | 说明 |
|------|------|------|
| 架构文档 | ⭐⭐⭐⭐ | `overview.md`、`ws-protocol.md`、`data-model.md` 准确反映现状 |
| 设计文档 | ⭐⭐⭐ | 愿景、需求、交互模式有覆盖，但部分已过时 |
| 开发指南 | ⭐⭐ | `getting-started.md` 可用，`testing.md` 严重过时 |
| AGENTS.md | ⭐⭐⭐⭐ | 规范全面，含日志、文档、编码标准 |
| .env.example | ⭐⭐ | 仅 7 个变量，遗漏 ACP/安全/日志等配置项 |

---

## 九、综合评分

| 维度 | 评分 | 关键结论 |
|------|------|---------|
| **架构分层** | ⭐⭐⭐⭐ | 后端分层清晰，事件驱动解耦有效 |
| **耦合控制** | ⭐⭐⭐ | store 层隔离好，但 gateway → 全层穿透、前端 Workspace 耦合过高 |
| **代码质量** | ⭐⭐⭐ | 无 `any`、结构化日志，但 God component 和内联样式拖后腿 |
| **类型安全** | ⭐⭐⭐ | 后端类型定义完善，但 RPC dispatch 和 WS client 弱类型 |
| **测试覆盖** | ⭐⭐⭐⭐ | 60 个测试覆盖核心逻辑，但无 UI/E2E 测试 |
| **错误处理** | ⭐⭐⭐⭐ | 后端统一、前端偏弱 |
| **安全性** | ⭐⭐ | 面向本地开发，默认无认证，RPC 无输入校验 |
| **文档** | ⭐⭐⭐ | 架构文档良好，指南和配置文档过时 |
| **可维护性** | ⭐⭐⭐ | 后端模块拆分合理，前端 Workspace 严重影响可维护性 |

**整体评级：⭐⭐⭐（3.2 / 5）** — 后端架构扎实，核心协议集成成熟；前端组件拆分和类型安全是最大短板。

---

## 十、优先改进建议

### P0 — 阻塞性问题

1. **拆分 Workspace.tsx** — 将 `ToolCallPanel`、`ChatBubble`、`ElicitationCard`、`PermissionCard`、`TaskPanel`、`NewTaskModal`、`PlanBar` 等拆到 `components/workspace/`，主组件控制在 300 行以内
2. **删除死代码** — `ChatView.tsx`、`SessionTimeline.tsx`、`ui/src/types/index.ts`

### P1 — 架构改进

3. **RPC 输入校验** — 在 `dispatchRpc` 层引入 Zod schema 验证，替代手工 `as string`
4. **WS 客户端类型化** — 为 `wsClient.on()` 的事件添加泛型约束，消除 `Record<string, unknown>`
5. **gateway RPC 仅依赖 core** — sessions RPC 不应直接引用 `acp/host` 和 `store/*`

### P2 — 质量提升

6. **前端错误提示** — fetch 失败时展示 toast/banner，替代静默 catch
7. **集中配置管理** — 将散落的 env 变量统一到 `AppConfig`，启动时校验
8. **更新过时文档** — `testing.md`、`.env.example`、清理 architecture/ 下的实现计划
9. **默认安全** — 未配置 token 时仅绑定 `127.0.0.1`，或自动生成随机 token

### P3 — 长期优化

10. **UI 组件测试** — 引入 Vitest + Testing Library 覆盖关键交互
11. **前端 CSS 方案** — 从纯内联样式迁移到 CSS Modules 或 Tailwind
12. **事件类型强化** — 将 `session:changed`/`task:update` 等事件的 `Record<string, unknown>` 替换为具体实体类型
