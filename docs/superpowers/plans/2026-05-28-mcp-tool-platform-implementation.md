# MCP Tool Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first usable MCP tool platform slice: method-level tool visibility, session tool-context tokens, HTTP MCP `/mcp`, and reusable ToolRuntime for platform/builtin/script tools.

**Architecture:** Keep the existing `tools` and `tool_bindings` tables as the method binding source. Add `tool_contexts` and `tool_call_audit`; resolve visible tool names per Agent/Project/Session into a token; expose one HTTP MCP gateway that filters `tools/list` and re-checks visibility on `tools/call`; reuse the same ToolRuntime from HTTP MCP and the existing stdio fallback.

**Tech Stack:** TypeScript 6, Hono, better-sqlite3, @modelcontextprotocol/sdk, Vitest.

---

## File Structure

Create/modify these focused files:

```text
src/tools/registry/context-registry.ts      # token create/validate/revoke backed by tool_contexts
src/tools/registry/visibility-resolver.ts   # resolves visible tools from existing tool_bindings
src/tools/runtime/tool-runtime.ts           # single execute/list path for builtin/script tools
src/tools/runtime/audit-service.ts          # tool_call_audit persistence helper
src/tools/mcp/http-mcp-server.ts            # Hono /mcp route using MCP WebStandard transport
src/tools/types.ts                          # add HTTP MCP server config and context row types
src/tools/resolver.ts                       # create token and prefer HTTP MCP when supported
src/tools/tool-gateway.ts                   # use ToolRuntime for stdio fallback
src/tools/seed.ts                           # seed method-style platform tools such as core.task.list
src/store/db.ts                             # add tool_contexts and tool_call_audit schema
src/gateway/server.ts                       # mount /mcp
src/acp/host.ts                             # pass sessionId and capability flag into resolver
```

Tests:

```text
tests/unit/tool-visibility-resolver.test.ts
tests/unit/tool-context-registry.test.ts
tests/unit/tool-runtime.test.ts
tests/integration/http-mcp-tool-platform.test.ts
tests/unit/tool-gateway-resolver.test.ts    # update existing expectations
```

---

### Task 1: Database tables for token contexts and audit

**Files:**
- Modify: `src/store/db.ts`
- Test: `tests/integration/sqlite-migration.test.ts`

- [ ] **Step 1: Write failing migration test**

Add a test that initializes a fresh DB and verifies these tables exist:

```ts
const tables = getDb().prepare<[], { name: string }>(`
  SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tool_contexts', 'tool_call_audit') ORDER BY name
`).all().map(row => row.name)
expect(tables).toEqual(['tool_call_audit', 'tool_contexts'])
```

Run:

```bash
npx vitest run tests/integration/sqlite-migration.test.ts
```

Expected: FAIL because the tables do not exist.

- [ ] **Step 2: Add schema**

Add `CREATE TABLE IF NOT EXISTS tool_contexts` and `tool_call_audit` in `createSchema()`.

`tool_contexts` columns:

```text
id TEXT PRIMARY KEY
token_hash TEXT NOT NULL UNIQUE
session_id TEXT NOT NULL
acp_session_id TEXT
agent_id TEXT NOT NULL
project_id TEXT
visible_tools_json TEXT NOT NULL
expires_at TEXT NOT NULL
revoked_at TEXT
created_at TEXT NOT NULL
```

`tool_call_audit` columns:

```text
id TEXT PRIMARY KEY
session_id TEXT NOT NULL
agent_id TEXT NOT NULL
project_id TEXT
tool_name TEXT NOT NULL
input_json TEXT NOT NULL
output_json TEXT
status TEXT NOT NULL
started_at TEXT NOT NULL
ended_at TEXT
error TEXT
```

Add indexes for token hash, session, and audit session/tool.

- [ ] **Step 3: Verify migration test passes**

Run:

```bash
npx vitest run tests/integration/sqlite-migration.test.ts
```

Expected: PASS.

---

### Task 2: Context registry and visibility resolver

**Files:**
- Create: `src/tools/registry/context-registry.ts`
- Create: `src/tools/registry/visibility-resolver.ts`
- Modify: `src/tools/types.ts`
- Test: `tests/unit/tool-context-registry.test.ts`
- Test: `tests/unit/tool-visibility-resolver.test.ts`

- [ ] **Step 1: Write failing context registry tests**

Test behaviors:

```text
createToolContext returns a raw token once and stores only token_hash
validateToolToken returns sessionId/agentId/projectId/visibleTools
revoked or expired tokens return null
```

Run:

```bash
npx vitest run tests/unit/tool-context-registry.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement context registry**

Implement:

```ts
createToolContext(input): { token: string; context: ToolContextRecord }
validateToolToken(token): ToolContextRecord | null
revokeToolContextBySession(sessionId): void
```

Use `randomBytes(32).toString('base64url')` for token and SHA-256 hash for storage.

- [ ] **Step 3: Write failing visibility tests**

Test:

```text
global + project + agent bindings resolve method names
agent-level disabled binding hides an otherwise global tool
external mcp tools are not included in platform visible tool names
```

Run:

```bash
npx vitest run tests/unit/tool-visibility-resolver.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 4: Implement visibility resolver**

Implement:

```ts
resolveVisiblePlatformTools({ agentId, projectId, sessionId? }): ResolvedTool[]
```

Rules:

```text
Only enabled builtin/script tools participate in platform HTTP MCP.
Global enabled binding includes a tool.
Project enabled binding includes a tool for that project.
Agent enabled binding includes a tool for that agent.
Agent disabled binding hides a tool even if global/project included it.
Project disabled binding hides a global tool for that project.
```

Keep external `type: 'mcp'` direct for now.

- [ ] **Step 5: Verify tests pass**

Run:

```bash
npx vitest run tests/unit/tool-context-registry.test.ts tests/unit/tool-visibility-resolver.test.ts
```

Expected: PASS.

---

### Task 3: ToolRuntime and audit service

**Files:**
- Create: `src/tools/runtime/audit-service.ts`
- Create: `src/tools/runtime/tool-runtime.ts`
- Modify: `src/tools/tool-gateway.ts`
- Test: `tests/unit/tool-runtime.test.ts`
- Existing integration: `tests/integration/tool-gateway-mcp.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Test:

```text
listTools returns only visible definitions
executeTool rejects a tool not in visibleTools
executeTool runs a visible script tool and writes succeeded audit
executeTool writes denied audit for invisible tool
```

Run:

```bash
npx vitest run tests/unit/tool-runtime.test.ts
```

Expected: FAIL because ToolRuntime does not exist.

- [ ] **Step 2: Implement audit service**

Implement:

```ts
recordToolCallStart(input): ToolCallAuditRow
finishToolCall(id, output): void
failToolCall(id, error, status): void
listToolCalls(sessionId): ToolCallAuditRow[]
```

- [ ] **Step 3: Implement ToolRuntime**

Implement:

```ts
listRuntimeTools(context): RuntimeToolDefinition[]
executeRuntimeTool(toolName, input, context): Promise<ToolHandlerResult>
```

Use existing handler lookup and script runner. `context.visibleTools` controls call permission.

- [ ] **Step 4: Route stdio gateway through ToolRuntime**

Change `buildGatewayTools()` to construct a runtime context with selected visible tool names and call `executeRuntimeTool()` instead of duplicating execution logic.

- [ ] **Step 5: Verify runtime and stdio tests pass**

Run:

```bash
npx vitest run tests/unit/tool-runtime.test.ts tests/integration/tool-gateway-mcp.test.ts
```

Expected: PASS.

---

### Task 4: HTTP MCP Gateway

**Files:**
- Create: `src/tools/mcp/http-mcp-server.ts`
- Modify: `src/gateway/server.ts`
- Test: `tests/integration/http-mcp-tool-platform.test.ts`

- [ ] **Step 1: Write failing HTTP MCP integration test**

Use `startGateway()` on a temp port, create two tokens with different visible tools, connect with `StreamableHTTPClientTransport`, and assert:

```text
token A tools/list returns only core.task.list
token B tools/list returns core.task.list and core.task.create
token A call core.task.create returns isError true or throws denied
token B call core.task.create succeeds
```

Run:

```bash
npx vitest run tests/integration/http-mcp-tool-platform.test.ts
```

Expected: FAIL because `/mcp` does not exist.

- [ ] **Step 2: Implement HTTP MCP route**

Use `WebStandardStreamableHTTPServerTransport` and create a fresh `McpServer` per request. Read `Authorization: Bearer <token>`, validate with context registry, register visible runtime tools, and return 401 for missing/invalid token.

- [ ] **Step 3: Mount route**

Call `mountHttpMcpServer(app)` in `src/gateway/server.ts` before `serve()`.

- [ ] **Step 4: Verify integration test passes**

Run:

```bash
npx vitest run tests/integration/http-mcp-tool-platform.test.ts
```

Expected: PASS.

---

### Task 5: Resolver prefers HTTP MCP and falls back to stdio

**Files:**
- Modify: `src/tools/resolver.ts`
- Modify: `src/acp/host.ts`
- Test: `tests/unit/tool-gateway-resolver.test.ts`

- [ ] **Step 1: Write/update failing resolver tests**

Add tests for:

```text
when preferHttp is true and sessionId is provided, resolver returns one HTTP ai-ide-tools server with Authorization header
when preferHttp is false, resolver keeps existing stdio gateway behavior
external mcp tools remain direct stdio entries
```

Run:

```bash
npx vitest run tests/unit/tool-gateway-resolver.test.ts
```

Expected: FAIL until resolver is updated.

- [ ] **Step 2: Update resolver API**

Add options:

```ts
resolveToolsAsMcpServers({ agentId, projectId, sessionId, preferHttp, baseUrl })
```

Keep backward compatibility wrapper or support old positional signature if needed by existing tests.

For HTTP mode:

```ts
createToolContext({ sessionId, agentId, projectId, visibleTools })
return [{ type: 'http', name: 'ai-ide-tools', url: `${baseUrl}/mcp`, headers: [{ name: 'Authorization', value: `Bearer ${token}` }] }]
```

For stdio mode, keep current output.

- [ ] **Step 3: Update ACP host**

In `newSession`, `resumeSession`, and `loadSession`, call resolver with:

```ts
preferHttp: conn.agentCapabilities?.mcpCapabilities?.http === true
baseUrl: process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? '18800'}`
sessionId: ourSessionId
```

- [ ] **Step 4: Verify resolver tests pass**

Run:

```bash
npx vitest run tests/unit/tool-gateway-resolver.test.ts
```

Expected: PASS.

---

### Task 6: First platform method tools

**Files:**
- Modify: `src/tools/handlers/create-task.ts`
- Create: `src/tools/handlers/list-tasks.ts`
- Modify: `src/tools/handlers/index.ts`
- Modify: `src/tools/seed.ts`
- Test: `tests/integration/http-mcp-tool-platform.test.ts`

- [ ] **Step 1: Write failing method-name tests**

Extend HTTP MCP integration test to use method names:

```text
core.task.list
core.task.create
```

Expected: FAIL until seed/handlers support method names.

- [ ] **Step 2: Add handlers**

Add `core.task.list` handler that returns tasks for `context.projectId`.

Update create task handler so both `create_task` and `core.task.create` can work, and pass `projectId: context.projectId` into `taskManager.createTask()`.

- [ ] **Step 3: Seed method-style tools**

Add builtin tools:

```text
core.task.list
core.task.create
```

Keep old `create_task` and `create_schedule` for compatibility.

- [ ] **Step 4: Verify tests pass**

Run:

```bash
npx vitest run tests/integration/http-mcp-tool-platform.test.ts tests/integration/tool-gateway-mcp.test.ts
```

Expected: PASS.

---

### Task 7: Documentation updates and full verification

**Files:**
- Modify: `docs/architecture/mcp-tool-platform.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/overview.md`
- Modify: `docs/architecture/tool-system.md`
- Modify: `README.md` if it has architecture/tool sections that need the new `/mcp` endpoint.

- [ ] **Step 1: Update docs**

Document implemented pieces:

```text
/mcp endpoint exists
tool_contexts and tool_call_audit tables exist
first methods are core.task.list and core.task.create
stdio gateway remains fallback
third-party MCP stays direct for now
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: all commands exit 0. Build may keep the existing Vite chunk size warning.

- [ ] **Step 3: Review diff**

Run:

```bash
git diff --stat
git status --short
```

Expected: only MCP tool platform implementation and docs changes.
