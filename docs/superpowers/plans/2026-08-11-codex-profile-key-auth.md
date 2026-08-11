# Codex Model Profile Key Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a bound Codex model profile's API key authoritative without changing model selection, Base URL behavior, global Codex configuration, or PRD lifecycle.

**Architecture:** Put the profile key in a dedicated environment variable scoped to the target Codex Agent process. Extend the existing `patch-package` patch for `codex-acp@0.0.44` so its custom gateway provider resolves credentials through `env_key`, which takes precedence over machine-wide Codex account authentication.

**Tech Stack:** TypeScript 6, Vitest 4, `@agentclientprotocol/codex-acp@0.0.44`, `patch-package`.

---

### Task 1: Inject the profile key into the Codex Agent process

**Files:**
- Modify: `src/acp/model-profile-env.ts`
- Test: `tests/unit/model-profile-env.test.ts`

- [x] **Step 1: Write the failing bound-profile test**

Extend `resolves a Codex profile into gateway authentication and a desired model` to assert the dedicated environment variable:

```typescript
expect(result.env.AI_IDE_CODEX_GATEWAY_API_KEY).toBe('sk-codex-profile')
```

- [x] **Step 2: Write the failing isolation and fingerprint tests**

Make the unbound-profile test pass a conflicting inherited value and assert that it is removed:

```typescript
const result = buildAgentRuntimeEnv('codex', agent, {
  MODEL_PROVIDER: 'system-provider',
  AI_IDE_CODEX_GATEWAY_API_KEY: 'stale-profile-key',
})
expect(result.env.AI_IDE_CODEX_GATEWAY_API_KEY).toBeUndefined()
```

Add a fingerprint assertion proving the secret changes the fingerprint without appearing in plain text:

```typescript
const first = fingerprintRuntimeEnv({ AI_IDE_CODEX_GATEWAY_API_KEY: 'profile-a' }, 'codex')
const second = fingerprintRuntimeEnv({ AI_IDE_CODEX_GATEWAY_API_KEY: 'profile-b' }, 'codex')
expect(first).not.toBe(second)
expect(first).not.toContain('profile-a')
```

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/model-profile-env.test.ts
```

Expected: FAIL because the dedicated environment variable is absent and excluded from Codex environment fingerprints.

- [x] **Step 4: Implement the minimal runtime environment change**

Add and export the credential variable name:

```typescript
export const CODEX_GATEWAY_API_KEY_ENV_KEY = 'AI_IDE_CODEX_GATEWAY_API_KEY'
```

In `buildAgentRuntimeEnv`, remove any inherited value for Codex before profile resolution. When a compatible enabled Codex profile is resolved, set the variable to the trimmed provider API key if non-empty.

Add `CODEX_GATEWAY_API_KEY_ENV_KEY` to the Codex branch of `fingerprintRuntimeEnv`. The existing `fingerprintValue` helper hashes names containing `API_KEY`, so the raw credential remains absent from fingerprints.

- [x] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/model-profile-env.test.ts
```

Expected: all tests in the file pass.

### Task 2: Make codex-acp resolve gateway authentication from the process key

**Files:**
- Modify: `patches/@agentclientprotocol+codex-acp+0.0.44.patch`
- Create: `tests/unit/codex-acp-gateway-auth-patch.test.ts`

- [x] **Step 1: Write the failing patch contract test**

Read the installed adapter source through `createRequire(import.meta.url).resolve('@agentclientprotocol/codex-acp')` and assert:

```typescript
expect(source).toContain('env_key: "AI_IDE_CODEX_GATEWAY_API_KEY"')
expect(source).toContain('delete headers.Authorization')
expect(source).toContain('delete headers.authorization')
```

The test checks the actual postinstall result, not only the patch text.

- [x] **Step 2: Run the patch contract test and verify RED**

Run:

```bash
npx vitest run tests/unit/codex-acp-gateway-auth-patch.test.ts
```

Expected: FAIL because the current installed adapter still configures only static `http_headers`.

- [x] **Step 3: Apply the minimal adapter change and regenerate the existing patch**

In `node_modules/@agentclientprotocol/codex-acp/dist/index.js`, after gateway headers are built, remove both Authorization casings:

```javascript
delete headers.Authorization;
delete headers.authorization;
```

Add the dedicated environment key to the custom gateway provider:

```javascript
env_key: "AI_IDE_CODEX_GATEWAY_API_KEY",
```

Regenerate the existing patch without losing its system-prompt and session-fork changes:

```bash
npx patch-package @agentclientprotocol/codex-acp
```

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/unit/model-profile-env.test.ts tests/unit/codex-acp-gateway-auth-patch.test.ts
```

Expected: both files pass.

- [x] **Step 5: Re-run the isolated conflicting-auth probe**

Start the patched adapter with a temporary `CODEX_HOME` containing a different `OPENAI_API_KEY`, send a custom Gateway authentication request, and capture the local `/v1/responses` Authorization header.

Expected: the captured credential is the profile-scoped environment key, not the temporary global key. Remove the temporary directory after the process exits.

### Task 3: Verify, commit, and integrate

**Files:**
- Verify all modified files
- Commit the implementation branch
- Merge `fix/codex-profile-auth-precedence` into `prd`

- [x] **Step 1: Run full verification**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: all commands exit 0 with no test failures or lint errors.

- [x] **Step 2: Review the final diff for scope and credential safety**

Confirm:

- No model-selection code changed.
- No database, migration, UI, Claude, or service lifecycle files changed.
- No raw API key appears in source, tests, logs, patch metadata, or Git diff.
- Existing `codex-acp` system-prompt and fork patch hunks remain present.

- [x] **Step 3: Commit the implementation**

```bash
git add src/acp/model-profile-env.ts tests/unit/model-profile-env.test.ts tests/unit/codex-acp-gateway-auth-patch.test.ts patches/@agentclientprotocol+codex-acp+0.0.44.patch docs/superpowers/plans/2026-08-11-codex-profile-key-auth.md
git commit -m "fix: isolate codex profile authentication"
```

- [x] **Step 4: Merge into PRD without restarting services**

From the main checkout, verify `prd` remains checked out and merge non-interactively:

```bash
git merge fix/codex-profile-auth-precedence --no-ff
```

Do not run the PRD start/stop scripts and do not terminate processes on port 18900.
