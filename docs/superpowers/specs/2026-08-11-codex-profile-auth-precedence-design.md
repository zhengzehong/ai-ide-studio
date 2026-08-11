# Codex Model Profile Authentication Precedence Design

## Background

AI IDE Studio lets a Codex Agent bind a model profile containing an OpenAI-compatible Base URL and API key. The current integration sends that key to `codex-acp` as a static `Authorization` entry in the custom gateway provider's `http_headers`.

Codex also loads the machine-wide `~/.codex/auth.json`. In `codex-acp@0.0.44`, the account authentication layer adds its own Authorization header after provider headers are created. The global `OPENAI_API_KEY` therefore replaces the profile key. A model profile only works when CC Switch happens to select the same provider.

The failure was reproduced with a local capture endpoint:

- With a conflicting `auth.json`, the final request used `OPENAI_API_KEY` instead of the gateway profile header.
- With an empty Codex home, the final request used the gateway profile header.
- With a dedicated provider `env_key`, the final request used the profile key even when conflicting global authentication remained present.

## Goals

- Make the API key bound to a Codex model profile authoritative for that Agent process.
- Allow different Codex Agents to use different providers concurrently.
- Keep unbound Codex Agents on the existing machine-wide Codex configuration.
- Apply Base URL or API key changes through the existing Agent fingerprint and idle replacement lifecycle.
- Avoid writing credentials to `~/.codex/auth.json`, project files, logs, or session events.

## Non-Goals

- Upgrading `@agentclientprotocol/codex-acp` or the ACP SDK.
- Isolating the complete `CODEX_HOME` directory.
- Changing model-selection precedence between Session preferences and Agent profiles.
- Adding database columns or migrations.
- Changing Claude Code authentication.

## Considered Approaches

### Dedicated provider environment key

Pass the profile credential to the Codex Agent process through a dedicated environment variable. Configure the custom gateway provider with `env_key` and remove Authorization from static provider headers.

This is the selected approach because Codex resolves provider `env_key` credentials before account authentication. It isolates credentials per child process without changing Codex home, sessions, skills, or user configuration.

### Per-profile Codex home

Start each profile in a separate `CODEX_HOME` without global authentication. This prevents header replacement but also separates sessions, cached models, skills, configuration, and plugin state. Preserving those resources would require copying or linking files and introduces a larger lifecycle surface.

### Dependency upgrade only

Upgrade `codex-acp` from `0.0.44` to `1.1.14`. The newer adapter still represents gateway credentials through `http_headers`, and the upgrade also changes the ACP SDK and Codex core major compatibility surface. It is not an evidence-backed fix for this bug.

## Design

### Runtime credential material

`buildAgentRuntimeEnv` will add a dedicated environment variable only when all of these conditions hold:

- Runtime is `codex`.
- The Agent has an enabled Codex model profile.
- The profile references an enabled OpenAI-compatible provider.
- The provider API key is non-empty.

The variable name is private to the AI IDE Studio adapter integration and is not persisted in Agent configuration. Unbound Codex Agents do not receive it.

### Gateway provider configuration

The installed `codex-acp` adapter will be patched through the repository's existing `patch-package` workflow:

- Remove `Authorization` and lowercase `authorization` from client-provided static headers.
- Preserve non-secret gateway headers such as `X-Client-Feature-ID`.
- Set the custom gateway provider's `env_key` to the dedicated environment variable.

The Base URL and Responses wire protocol remain unchanged.

### Runtime lifecycle

The existing gateway fingerprint already hashes protocol, normalized Base URL, and API key. A changed key or URL therefore produces a different Agent fingerprint. Runtime replacement continues to wait for the Agent to become idle and affects only that Agent, not the PRD service or unrelated Agents.

### Credential safety

- The raw key is present only in the database access layer, the in-memory runtime snapshot, and the target child process environment.
- Logs continue to emit only the gateway fingerprint.
- The dedicated environment variable must be included in credential redaction/fingerprinting rules and must never be logged as plain text.
- Static gateway headers must not retain Authorization after the adapter transforms them.

## Error Handling

- An empty provider key leaves the dedicated environment variable unset. The gateway request then fails normally with the upstream authentication error instead of silently falling back to global credentials.
- A profile with an incompatible protocol remains unapplied, preserving current behavior.
- Runtime initialization failures continue through the existing lifecycle failure path; no global auth files are modified as recovery.

## Testing

### Unit coverage

- A bound Codex profile adds the dedicated environment variable.
- An unbound Codex Agent does not inherit a provider key.
- Credential fingerprints redact/hash the dedicated environment variable.
- Gateway patch output contains `env_key` and removes Authorization from static headers.

### Integration regression

Run `codex-acp` against a local capture server with a temporary `CODEX_HOME` whose `auth.json` contains a conflicting API key. Assert that the final `/v1/responses` Authorization header uses the profile key.

Run two isolated Codex Agent processes with different profile keys and assert that each request carries its own key.

### Project verification

- `npm test`
- `npm run build`
- `npm run lint`
- `git diff --check`

## Rollout

The change requires rebuilding/restarting the application code before PRD can use it, but implementation and verification must not stop or restart the currently running PRD instance. After deployment, bound Codex Agents become independent from CC Switch; unbound Agents remain unchanged.
