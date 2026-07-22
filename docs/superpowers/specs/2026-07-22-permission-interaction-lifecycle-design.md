# Permission Interaction Lifecycle Design

## Problem

Permission and elicitation requests are persisted as Session events so the UI can recover after navigation or reconnect. A request currently remains recoverable until a matching result event exists. Runtime shutdown, Session unbind, interaction timeout, and child-process exit resolve the in-memory ACP promise but do not publish a result event. Consequently, a completed or interrupted turn can leave a historical request that the UI restores indefinitely.

When the user responds to such a historical request, Runtime correctly reports that it no longer owns the interaction. The UI neither removes the stale card nor presents the command failure, making the control appear unresponsive. In addition, Runtime trusts the ACP implementation to honor full-access modes; if ACP still invokes `requestPermission`, Studio only auto-approves explicitly allowlisted internal tools.

## Desired Behavior

1. Recovery never restores an interaction from a turn that already reached `message.done`.
2. Runtime cleanup publishes a cancelled interaction result before resolving the ACP fallback, allowing normal persistence and realtime removal.
3. An expired response removes the stale card and tells the user to send the message again.
4. Claude `bypassPermissions` and Codex `agent-full-access` are enforced at Studio's ACP callback boundary, even if the ACP adapter asks for approval.
5. Ordinary permission modes and explicit per-tool auto-approval retain their current behavior.

## Architecture

### Recovery boundary

`eventStore.listRecovery` remains the source of lightweight recovery state. General state events continue to be returned, while permission and elicitation events are returned only when their sequence is newer than the Session's latest `message.done`. This makes the terminal turn boundary authoritative without returning full message or tool history.

This query-level rule fixes existing PRD data immediately after the new build starts; no data migration or destructive cleanup is required.

### Runtime interaction completion

Each pending interaction records a cancellation callback alongside its ACP resolver and timeout. Timeout, Session cancellation, unbind, and Runtime close invoke the callback exactly once. The callback publishes `permission.result` or `elicitation.result` with the request ID before resolving the ACP fallback.

Normal user responses continue through `permission.respond` and `elicitation.respond`; they remove the pending entry without invoking the cancellation callback, so no duplicate result event is produced.

### Full-access enforcement

The Runtime router stores only the permission mode confirmed by ACP for each bound Studio Session. A saved or default preference does not enable automatic approval until ACP advertises and successfully applies it. `requestPermission` selects a one-time allow option first when the confirmed mode is `bypassPermissions` or `agent-full-access`, falling back to an always-allow option only when ACP offers no one-time choice. Explicit internal-tool allowlists retain their existing always-allow preference. Successful mode/config changes and ACP mode/config updates keep the router synchronized with the resulting capabilities.

### Frontend expired-response handling

Session stores keep an interaction error keyed by Session. When the command response says that a permission or elicitation request expired, the matching request is removed locally and a Chinese actionable error is displayed near the composer. Successful responses and new interaction requests clear the old error. The global assistant follows the same behavior.

## Error Handling

- Missing or expired interactions remain failed commands in the durable command ledger.
- The UI converts the known expired-interaction error into a recoverable state transition; unrelated transport failures remain visible and do not silently discard a potentially valid request.
- Runtime cleanup callbacks are idempotent because pending entries are removed before completion.

## Testing

- Integration test: recovery excludes a permission request followed by `message.done`, while retaining an active request after the latest done boundary.
- Unit tests: Runtime cleanup publishes cancelled results for permission and elicitation requests.
- Unit tests: full-access modes auto-approve arbitrary ACP permission callbacks without publishing a card; ordinary modes still publish.
- Store tests: an expired permission response removes the card and records the actionable error.
- Full TypeScript, lint, build, unit/integration suite, and whitespace verification before merge.

## Scope

No schema migration, PRD data rewrite, service restart, mobile UI change, or unrelated permission-policy redesign is included.
