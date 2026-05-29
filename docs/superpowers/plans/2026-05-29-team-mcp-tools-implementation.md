# Team MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Team MCP 工具第一版数据层、服务层、工具 handler 和 seed，让 Agent 可以通过 `team.*` 方法创建团队、创建成员、派活、反馈和更新团队任务。

**Architecture:** Team 复用现有 Project / Agent / Session / Task 体系；新增 Team / TeamMember / TeamMailbox / TeamEvent 数据表，Team Task 通过 `tasks.team_id` 和 `tasks.assignee_member_id` 表达。工具权限仍由 token 可见性控制，handler 只做业务一致性校验。

**Tech Stack:** TypeScript + better-sqlite3 + Vitest + 现有 ToolRuntime / MCP Gateway。

---

### Task 1: Team 数据模型迁移和 Store

**Files:**
- Create: `src/store/migrations/005-team-mcp-tools.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/tasks.ts`
- Create: `src/store/teams.ts`
- Test: `tests/integration/team-mcp-tools.test.ts`

- [ ] 写失败测试：迁移后存在 `teams`、`team_members`、`team_mailbox`、`team_events`，且 `tasks` 有 `team_id`、`assignee_member_id`。
- [ ] 运行 `npm test -- tests/integration/team-mcp-tools.test.ts`，确认因迁移缺失失败。
- [ ] 实现 005 迁移与 Team Store 的 create/get/list/update、member、mailbox、event 方法。
- [ ] 扩展 taskStore 支持 teamId / assigneeMemberId 的 create/list/update。
- [ ] 运行目标测试确认通过。

### Task 2: Team 服务和工具 Handler

**Files:**
- Create: `src/core/teams.ts`
- Create: `src/tools/handlers/team/team-tools.ts`
- Create: `src/tools/handlers/team/index.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/types.ts`
- Test: `tests/unit/team-tool-handlers.test.ts`

- [ ] 写失败测试：`team.create` 创建 Team 和初始 member/session；`team.member.spawn` 从模板创建成员；`team.mailbox.send` 只写 mailbox；`team.task.update` 更新任务完成状态。
- [ ] 运行 `npm test -- tests/unit/team-tool-handlers.test.ts`，确认 handler 缺失失败。
- [ ] 实现 Team Service：封装 project/team/member/task 一致性校验和调用现有 agent/session/task store。
- [ ] 实现 14 个 `team.*` handler，并注册到 handler index。
- [ ] 运行目标测试确认通过。

### Task 3: Tool seed、上下文和文档

**Files:**
- Modify: `src/tools/seed.ts`
- Modify: `src/tools/registry/context-registry.ts`
- Modify: `src/tools/resolver.ts`
- Modify: `src/tools/mcp/http-mcp-server.ts`
- Modify: `src/tools/tool-gateway.ts`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `docs/architecture/overview.md`
- Modify: `README.md`
- Test: `tests/unit/tool-seed.test.ts`, `tests/unit/tool-context-registry.test.ts`

- [ ] 写/扩展失败测试：seed 后包含 `team.*` 工具；ToolContext 可保存并恢复 `teamId/teamMemberId`。
- [ ] 实现 seed 列表与 ToolContext 字段透传。
- [ ] 更新架构文档和 README，只描述稳定结构，不写实施流水账。
- [ ] 运行 `npm test`、`npm run build`、`npm run lint`。
