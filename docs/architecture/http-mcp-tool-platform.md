# HTTP MCP Tool Platform Architecture

> Status: proposed long-term architecture. This document supersedes the per-session stdio gateway as the target design while keeping the current `ai-ide-tool-gateway` implementation as a compatibility step.

## Goal

AI IDE Studio should become a tool platform for ACP agents, not only a UI wrapper around Claude Code or Codex. The platform must expose project, task, session, schedule, team, knowledge, admin, and custom tools to agents through MCP with fine-grained tool visibility, approval, audit, and future extension points.

The target architecture is a long-running HTTP MCP Gateway inside the AI IDE Studio server. Claude and Codex ACP adapters both support HTTP MCP through `mcpServers`, so the default path should be HTTP MCP instead of starting a full stdio MCP process for every agent session.

## Design Principles

1. **One platform-owned tool plane**: all built-in tools, custom tools, and proxied external MCP tools pass through a single policy, approval, and audit layer.
2. **Per-session visibility without per-session heavy processes**: each ACP session receives a tool context token. `tools/list` returns only tools allowed by that token.
3. **Tool namespaces are logical, not process boundaries**: `core`, `team`, `admin`, `knowledge`, `external`, and `custom` are policy namespaces. They do not require separate MCP processes.
4. **Execution is always checked twice**: visibility filtering hides unauthorized tools; `tools/call` still enforces permissions before executing.
5. **Extensibility by module registration**: adding a feature means adding a `ToolDefinition` and handler module, then binding it through policies. ACP host and agent adapters should not need changes.
6. **No direct bypass for heavy or sensitive tools**: browser, filesystem, shell, GitHub, and other external MCP tools should eventually be proxied through AI IDE Studio, so approval/audit/limits remain centralized.

## Current State

Current code has a useful first layer:

- `src/tools/types.ts`: tool definition and binding types.
- `src/tools/resolver.ts`: resolves tools for an agent/project and emits MCP server config.
- `src/tools/tool-gateway.ts`: stdio MCP server for built-in/script tools.
- `src/tools/permission-guard.ts`: basic execution checks.
- `src/store/tools.ts`: `tools` and `tool_bindings` persistence.

Current limitations:

- Built-in/script tools are exposed through a per-session stdio process.
- Tool context is passed via environment variables such as `TOOL_IDS`, `PROJECT_ID`, `AGENT_ID`.
- Permission state is mostly startup-time and not dynamic per call.
- Approval and audit are not first-class runtime services.
- External MCP servers can still bypass the platform if directly injected into ACP sessions.

## Target Runtime Topology

```text
AI IDE Studio Server
  ├─ Gateway Layer
  │   ├─ HTTP / WebSocket API
  │   └─ HTTP MCP endpoint: /mcp
  │
  ├─ ACP Host
  │   ├─ starts Claude/Codex ACP adapters
  │   ├─ creates/resumes/forks ACP sessions
  │   └─ injects mcpServers with a tool context token
  │
  ├─ Tool Platform
  │   ├─ Tool Registry
  │   ├─ Tool Policy Engine
  │   ├─ Tool Context Registry
  │   ├─ Tool Runtime
  │   ├─ Approval Service
  │   ├─ Audit Service
  │   └─ External MCP Proxy / Pool
  │
  └─ Core Managers / Stores
      ├─ projects / agents / sessions
      ├─ tasks / schedules / teams
      ├─ skills / models / templates
      └─ knowledge / memory

Claude or Codex ACP Agent
  └─ newSession({
       mcpServers: [{
         type: 'http',
         name: 'ai-ide-tools',
         url: 'http://127.0.0.1:<port>/mcp',
         headers: [{ name: 'Authorization', value: 'Bearer <tool-context-token>' }]
       }]
     })
```

## Why HTTP MCP

The ACP adapters currently used by the project expose HTTP MCP capabilities:

- `@agentclientprotocol/claude-agent-acp`: supports `http` and `sse` MCP servers.
- `@agentclientprotocol/codex-acp`: supports `http` MCP servers and does not advertise SSE.

Therefore the common target transport should be HTTP MCP. Stdio MCP remains useful only as a fallback for agents that do not support HTTP MCP or for compatibility tests.

## Tool Context Token

Every ACP session gets a platform-generated token. The token is passed as an MCP HTTP header and maps to a server-side context.

```ts
interface ToolContextRecord {
  id: string
  tokenHash: string
  sessionId: string
  acpSessionId?: string
  agentId: string
  projectId?: string
  role?: 'member' | 'leader' | 'admin' | string
  allowedTools: string[]
  scopes: string[]
  policyVersion: number
  expiresAt: string
  revokedAt?: string | null
  createdAt: string
}
```

Rules:

- The raw token is only returned at creation time and is never stored in plaintext.
- `tools/list` uses this context to return only visible tools.
- `tools/call` uses this context to enforce permissions again.
- Tokens can be revoked when a session closes, an agent is stopped, or policies change.
- Token TTL should be long enough for active sessions but renewable on session resume.

## Tool Definition

The tool definition should evolve from the current table-oriented shape to a runtime-ready module shape.

```ts
interface ToolDefinition {
  name: string                         // e.g. core.task.create
  displayName: string                  // human-readable UI label
  namespace: 'core' | 'team' | 'admin' | 'knowledge' | 'external' | 'custom'
  description: string
  inputSchema: object
  outputSchema?: object
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  requiredScopes: string[]             // e.g. ['task:create']
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  defaultApproval: 'never' | 'on-risk' | 'always'
  timeoutMs: number
  handler: ToolHandler
}
```

MCP tool annotations are helpful hints for agents, but they are not a security boundary. Enforcement must happen in the Tool Runtime.

## Policy Model

Policies decide visibility and execution rights.

```ts
interface ToolPolicy {
  id: string
  name: string
  scope: 'global' | 'project' | 'agent' | 'role' | 'session'
  targetId?: string | null
  allowTools: string[]                 // exact names or wildcard patterns
  denyTools: string[]
  allowNamespaces: string[]
  denyNamespaces: string[]
  scopes: string[]
  approvalOverrides?: Record<string, 'never' | 'on-risk' | 'always'>
  priority: number
  enabled: boolean
}
```

Resolution order:

1. Start with global defaults.
2. Apply project policies.
3. Apply role policies.
4. Apply agent policies.
5. Apply session overrides.
6. Apply explicit denies last.

Visibility and execution can differ. A tool may be visible but still request approval before executing.

## Permission and Approval Flow

```text
MCP tools/call
  ↓
Authenticate tool context token
  ↓
Find ToolDefinition
  ↓
Check visibility and required scopes
  ↓
Check risk/approval policy
  ↓
If approval required:
    create approval request
    publish WS event to UI
    wait for approve/deny/cancel/timeout
  ↓
Execute through ToolRuntime
  ↓
Persist audit record
  ↓
Return MCP result
```

Approval is platform-level approval for platform tools. It is separate from Claude/Codex built-in permission prompts, though both can be displayed in the same UI timeline.

## Audit Model

Every call should create an audit event.

```ts
interface ToolCallAuditRecord {
  id: string
  sessionId: string
  agentId: string
  projectId?: string
  toolName: string
  inputJson: string
  outputJson?: string
  status: 'pending_approval' | 'running' | 'succeeded' | 'failed' | 'denied' | 'cancelled' | 'timeout'
  approvalId?: string
  startedAt: string
  endedAt?: string
  error?: string
}
```

Audit records support:

- debugging wrong agent behavior;
- team result collection;
- user-visible activity timelines;
- future usage/cost/risk reports.

## Tool Namespaces

### Core

Default low-risk platform tools:

- `core.project.list`
- `core.project.get`
- `core.agent.list`
- `core.agent.get`
- `core.session.list`
- `core.session.create`
- `core.session.send_prompt`
- `core.session.close`
- `core.task.list`
- `core.task.get`
- `core.task.create`
- `core.task.update`
- `core.schedule.list`
- `core.schedule.create`
- `core.permission.describe`
- `core.tool.available`

### Team

Team tools should be a separate namespace because they can spawn, coordinate, or stop agents.

- `team.team.list`
- `team.team.status`
- `team.team.create`
- `team.member.list`
- `team.member.add`
- `team.member.remove`
- `team.task.assign`
- `team.note.send`
- `team.result.collect`
- `team.member.stop`

Example role policies:

```json
{
  "name": "team-member",
  "allowTools": ["team.team.list", "team.team.status", "team.member.list"],
  "scopes": ["team:read"]
}
```

```json
{
  "name": "team-leader",
  "allowNamespaces": ["team"],
  "denyTools": ["team.team.delete"],
  "scopes": ["team:read", "team:write"]
}
```

### Admin

Admin tools are not default-visible to agents.

- `admin.tool.list`
- `admin.tool.bind`
- `admin.tool.unbind`
- `admin.skill.create`
- `admin.skill.bind`
- `admin.model.update`
- `admin.template.update`

### External

External MCP tools should eventually be proxied through the platform:

- browser / Playwright
- search
- GitHub
- filesystem
- shell-like tools

The proxy allows centralized approval, audit, rate limiting, and per-agent visibility.

### Custom

User-defined script tools remain supported, but execution must go through the same policy, approval, timeout, and audit path.

## HTTP MCP Endpoint Responsibilities

The HTTP MCP gateway should support at least:

- MCP initialization;
- `tools/list`;
- `tools/call`;
- MCP tool annotations;
- consistent error responses;
- token authentication;
- per-request audit correlation.

Later it can add:

- `resources/list` and `resources/read` for project/knowledge resources;
- `prompts/list` and `prompts/get` for reusable prompt templates;
- list-changed notifications if supported by active clients.

## Fallback Strategy

Primary path:

```text
ACP Agent supports HTTP MCP -> inject ai-ide HTTP MCP with token
```

Fallback path:

```text
Agent does not support HTTP MCP -> inject thin stdio proxy
thin proxy forwards to the same Tool Runtime / HTTP MCP gateway
```

The fallback proxy must remain thin. It should not load the full database or duplicate handler logic.

## Migration from Current Gateway

Current `ai-ide-tool-gateway` should be treated as a compatibility entrypoint:

1. Keep current stdio gateway tests.
2. Extract handler registration into reusable modules.
3. Add HTTP MCP gateway that uses the same `ToolRuntime`.
4. Change `resolveToolsAsMcpServers()` to prefer HTTP MCP when ACP agent capabilities allow it.
5. Keep stdio gateway only as fallback.

## Open Decisions

- Whether to store policy rules in the existing `tools` / `tool_bindings` tables or introduce `tool_policies` / `tool_policy_bindings` immediately.
- Whether token contexts should be persisted in SQLite or kept in memory with optional recovery on session resume.
- Whether external MCP proxying should be part of the first implementation wave or a separate wave after core/team tools.
