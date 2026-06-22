# Agent Template MCP Tools

## Goal

Expose Agent Square template CRUD as MCP tools so an agent can create, inspect,
update, and delete Agent templates.

## Scope

- Add `agent.template.list`
- Add `agent.template.get`
- Add `agent.template.create`
- Add `agent.template.update`
- Add `agent.template.delete`
- Keep deployment, subscriptions, and tool-profile permissions out of this
  change.

## Verification

1. Add failing unit coverage for template CRUD MCP handlers.
2. Add builtin tool seed coverage for the new tool names and schemas.
3. Run targeted tests.
4. Run lint/build checks if targeted tests pass.
