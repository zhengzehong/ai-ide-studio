# HTTP MCP Tool Platform Implementation Approach

> This document describes how to implement the long-term architecture in `docs/architecture/http-mcp-tool-platform.md`. It is intentionally staged, but the stages are architectural milestones, not throwaway shortcuts.

## Target Outcome

AI IDE Studio exposes one long-running, policy-aware HTTP MCP Gateway. Claude and Codex ACP sessions connect to that gateway with a per-session tool context token. Built-in tools, team tools, admin tools, custom script tools, and proxied external MCP tools all share one policy, approval, execution, and audit path.

## Milestone 1: Extract Tool Runtime Core

Goal: make current stdio gateway use a reusable runtime instead of owning execution logic directly.

Files to create or reshape:

```text
src/tools/registry/tool-registry.ts
src/tools/registry/policy-engine.ts
src/tools/registry/context-registry.ts
src/tools/runtime/tool-runtime.ts
src/tools/runtime/permission-service.ts
src/tools/runtime/approval-service.ts
src/tools/runtime/audit-service.ts
src/tools/modules/core/index.ts
src/tools/modules/team/index.ts
src/tools/modules/admin/index.ts
```

Work:

1. Move built-in handler discovery out of `src/tools/tool-gateway.ts`.
2. Define `ToolDefinition` as the runtime source of truth.
3. Keep DB-backed `tools` rows as persisted configuration, but have runtime modules register built-in definitions in code.
4. Implement `ToolRuntime.execute(toolName, input, context)`.
5. Route current stdio gateway through `ToolRuntime`.

Acceptance criteria:

- Existing stdio gateway tests still pass.
- Built-in tools can be listed and executed through the extracted runtime.
- No handler directly bypasses permission/audit service.

## Milestone 2: Policy and Context Model

Goal: compute per-session tool visibility and execution scopes.

Suggested schema additions:

```sql
CREATE TABLE tool_contexts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  acp_session_id TEXT,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  role TEXT,
  allowed_tools_json TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  policy_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE tool_call_audit (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  status TEXT NOT NULL,
  approval_id TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error TEXT
);

CREATE TABLE tool_approval_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  decision TEXT,
  reason TEXT
);
```

Policy handling:

1. Reuse existing `tools` and `tool_bindings` as the first policy source.
2. Add an internal `PolicyEngine.resolve({ agentId, projectId, role, sessionId })` API.
3. Return `allowedTools`, `scopes`, and approval overrides.
4. Do not expose denied tools in MCP `tools/list`.
5. Re-check all calls in `tools/call`.

Acceptance criteria:

- Different agents can get different visible tools from the same runtime.
- `team-member` can see list/status tools but not create/assign/stop tools.
- Denied tool calls fail even if manually crafted.

## Milestone 3: HTTP MCP Gateway

Goal: add a long-running HTTP MCP endpoint to the main server.

Files:

```text
src/tools/mcp/http-mcp-server.ts
src/tools/mcp/mcp-response.ts
src/gateway/server.ts
src/acp/host.ts
src/tools/resolver.ts
```

Work:

1. Add `/mcp` route to the existing Hono server.
2. Authenticate requests with `Authorization: Bearer <tool-context-token>`.
3. Implement MCP initialize, `tools/list`, and `tools/call` using the official MCP SDK if its HTTP transport fits the project; otherwise implement the minimal JSON-RPC surface behind a small adapter layer.
4. Make `resolveToolsAsMcpServers()` prefer HTTP MCP output:

```ts
{
  type: 'http',
  name: 'ai-ide-tools',
  url: `${serverBaseUrl}/mcp`,
  headers: [{ name: 'Authorization', value: `Bearer ${token}` }]
}
```

5. Keep stdio gateway fallback for agents without HTTP MCP support.

Acceptance criteria:

- Claude ACP session receives HTTP MCP server config.
- Codex ACP session receives HTTP MCP server config.
- `tools/list` differs by token/policy.
- `tools/call` executes through the same `ToolRuntime` as the stdio gateway.

## Milestone 4: Core Tool Set

Goal: expose platform-native tools that let agents work with existing AI IDE Studio objects.

Initial core tools:

```text
core.project.list
core.project.get
core.agent.list
core.agent.get
core.session.list
core.session.create
core.session.send_prompt
core.session.close
core.task.list
core.task.get
core.task.create
core.task.update
core.schedule.list
core.schedule.create
core.permission.describe
core.tool.available
```

Implementation notes:

- Read tools use `readOnlyHint: true`, `riskLevel: low`, and no approval.
- Write tools require corresponding scopes.
- `core.session.send_prompt` should be medium risk because it can trigger agent work.
- `core.schedule.create` should default to approval or at least configurable approval.

Acceptance criteria:

- An agent can list tasks and create a task through MCP.
- An agent with read-only policy cannot create a task.
- Audit records are written for both successful and denied calls.

## Milestone 5: Team Tool Set

Goal: make Team a first-class namespace with stricter policies.

Initial team tools:

```text
team.team.list
team.team.status
team.team.create
team.member.list
team.member.add
team.member.remove
team.task.assign
team.note.send
team.result.collect
team.member.stop
```

Policy presets:

```text
team-member:
  allow: team.team.list, team.team.status, team.member.list
  scopes: team:read

team-leader:
  allow namespace: team
  deny: team.team.delete
  scopes: team:read, team:write

team-admin:
  allow namespace: team
  scopes: team:read, team:write, team:admin
```

Approval defaults:

```text
team.member.stop: always
team.member.remove: always
team.team.create: on-risk
team.task.assign: on-risk
team.note.send: never or on-risk based on project policy
team.result.collect: never
```

Acceptance criteria:

- A normal member cannot see or call create/assign/stop tools.
- A leader can assign tasks and collect results.
- Stop/remove calls produce approval requests.

## Milestone 6: Admin and Custom Tools

Goal: expose administrative and user-created tools safely.

Admin namespace:

```text
admin.tool.list
admin.tool.bind
admin.tool.unbind
admin.skill.list
admin.skill.create
admin.skill.bind
admin.model.list
admin.model.update
admin.template.list
admin.template.update
```

Custom tools:

- Script tools continue to use Node execution first.
- Script path restrictions remain mandatory.
- Script timeout and output limits are enforced by `ToolRuntime`.
- Custom tools are never globally visible unless explicitly bound.

Acceptance criteria:

- Admin tools are invisible by default.
- Custom tools require explicit binding and permission checks.
- Script failures return MCP errors and write audit records.

## Milestone 7: External MCP Proxy

Goal: stop directly injecting sensitive external MCP servers into ACP sessions.

Proxy model:

```text
Agent -> AI IDE HTTP MCP Gateway -> ExternalMcpClientPool -> external MCP server
```

Start with one external adapter, for example browser or GitHub.

Responsibilities:

- Normalize external tool names into `external.<server>.<tool>`.
- Apply policy visibility.
- Apply approval rules for destructive/open-world tools.
- Pool heavy external servers such as browser automation.
- Audit inputs/outputs with truncation.

Acceptance criteria:

- External tool appears in `tools/list` only when policy allows it.
- External tool calls are audited by AI IDE Studio.
- Heavy external processes are pooled or lazily started, not per agent session.

## Milestone 8: UI and Operations

Goal: expose permissions, approvals, and audit in the product.

UI surfaces:

```text
Tool Manager:
  - tool list
  - namespace/category filter
  - policy bindings
  - test tool

Agent/Project settings:
  - assign policy preset
  - override allowed tools
  - view effective tools

Workspace timeline:
  - platform tool call event
  - approval request
  - approval result

Audit page:
  - filter by session/agent/project/tool/status
```

Operational controls:

- Token revoke on session close.
- Tool call timeout and cancellation.
- Concurrency limits per tool and per agent.
- Output truncation and sensitive field redaction.

## Implementation Order Recommendation

Do not implement all tools first. Implement the framework, then small representative tool sets:

1. Runtime extraction.
2. Context token and policy engine.
3. HTTP MCP endpoint.
4. One read tool and one write tool in `core`.
5. Team read-only vs leader policy proof.
6. Approval and audit.
7. Expand tools.
8. External MCP proxy.

This order validates the architecture early without building throwaway code.

## Testing Strategy

Unit tests:

- policy resolution with allow/deny precedence;
- token creation, hashing, expiry, revoke;
- permission guard denial cases;
- approval required vs not required;
- audit status transitions.

Integration tests:

- HTTP MCP `tools/list` returns different tools for different tokens;
- HTTP MCP `tools/call` succeeds for allowed tool;
- HTTP MCP `tools/call` denies invisible/disallowed tool;
- ACP host injects HTTP MCP server config for Claude/Codex-capable agents;
- stdio fallback still works.

Manual smoke tests:

- create Claude agent session and list MCP tools;
- create Codex agent session and list MCP tools;
- run `core.task.create` through the agent;
- verify audit record and UI event.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| MCP SDK HTTP transport mismatch | Keep a narrow `src/tools/mcp` adapter so protocol details are isolated. |
| Token leakage in logs | Store only hashes; redact Authorization headers in logs. |
| Agent sees stale tool list | Use short token TTL plus list-changed notification where supported; recreate/resume session after policy changes if needed. |
| External MCP bypass | Move external tools behind proxy before enabling them for production policies. |
| Approval deadlock | Approval requests must support timeout, cancellation, and session close cleanup. |
| Too many high-risk tools visible | Default policies should be minimal; admin/team-write tools require explicit binding. |

## Compatibility Contract

Current stdio gateway remains a compatibility mechanism, but new feature development should target the HTTP Tool Platform APIs. New tools should be written as `ToolDefinition` modules and must not depend on whether they are called by HTTP MCP, stdio fallback, UI test action, or future SDK API.
