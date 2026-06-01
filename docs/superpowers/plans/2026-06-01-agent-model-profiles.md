# Agent Model Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a front-end model profile workflow so providers can define reusable Claude/Codex model settings, including model context, and project Agents can bind one profile.

**Architecture:** Keep providers as connection records and add model profiles as reusable runtime-specific records. Store Agent bindings in `agents.config_json` to avoid a broad schema change. The first implementation only persists and displays configuration; runtime env application can be added after this UI/data model is confirmed.

**Tech Stack:** Hono RPC, better-sqlite3 migrations/stores, React 19, Zustand, TypeScript, Vitest.

---

### Task 1: Data Model And RPC

**Files:**
- Create: `src/store/model-profiles.ts`
- Create: `src/store/migrations/006-model-profiles.ts`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/gateway/rpc/models.ts`
- Modify: `src/core/agents.ts`
- Modify: `src/gateway/rpc/agents.ts`
- Modify: `src/store/agents.ts`
- Test: `tests/unit/model-profiles.test.ts`

- [x] **Step 1: Write failing tests for profile CRUD and Agent binding**

Create `tests/unit/model-profiles.test.ts` with tests that create a provider, create Claude and Codex model profiles with `contextWindow`, list by runtime, update a profile, and bind a profile to an Agent through `agentStore.update` config.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/model-profiles.test.ts`
Expected: FAIL because `modelProfileStore` and migration `006` do not exist.

- [x] **Step 3: Add `model_profiles` migration**

Create `src/store/migrations/006-model-profiles.ts` with table fields: `id`, `name`, `runtime`, `provider_id`, `config_json`, `context_window`, `enabled`, `created_at`, `updated_at`. Register it in `src/store/migrations/index.ts` after migration `005`.

- [x] **Step 4: Add model profile store**

Create `src/store/model-profiles.ts` with named exports for `ModelProfileRow`, runtime config types, `create`, `get`, `list`, `update`, `delete`, and `toggle`. Store runtime-specific values in `config_json`.

- [x] **Step 5: Add RPC handlers**

Extend `src/gateway/rpc/models.ts` with `modelProfiles.list/create/update/delete/toggle`. Keep profile validation minimal: runtime must be `claude` or `codex`, provider must exist, and `contextWindow` must be a positive number when provided.

- [x] **Step 6: Allow Agent model profile binding**

Extend core/RPC Agent inputs with optional `modelProfileId`. Store it under `config_json.modelProfileId` while preserving existing config keys like `templateId` and `skills`.

- [x] **Step 7: Run targeted tests**

Run: `npm test -- tests/unit/model-profiles.test.ts tests/unit/runtime-registry.test.ts`
Expected: PASS.

### Task 2: Front-End Store And Types

**Files:**
- Modify: `ui/src/stores/model.store.ts`
- Modify: `ui/src/stores/agent.store.ts`

- [x] **Step 1: Add front-end profile types**

Add `ModelProfileData`, `ClaudeProfileConfig`, and `CodexProfileConfig` to `model.store.ts`. Include `context_window` and `config_json`.

- [x] **Step 2: Add profile store actions**

Add `fetchProfiles`, `createProfile`, `updateProfile`, `deleteProfile`, and `toggleProfile` actions using the new RPC method names.

- [x] **Step 3: Add Agent input field**

Add optional `modelProfileId` to `ProjectAgentInput`, `deployTemplate`, `createCustomAgent`, and `updateAgent` payloads.

- [x] **Step 4: Run type check through build later**

No standalone UI type command exists; verify with `npm run build` in the final task.

### Task 3: Settings Page Model Profiles UI

**Files:**
- Modify: `ui/src/pages/Settings.tsx`

- [x] **Step 1: Add page sections**

Keep `模型供应商` and add a second section `模型档案`. The profile section lists runtime, provider, context window, and runtime-specific model fields.

- [x] **Step 2: Add profile form modal**

Create a local `ProfileForm` component inside `Settings.tsx`. The form fields are: profile name, runtime, provider, context window. Claude runtime shows `默认模型`, `Haiku 模型`, `Sonnet 模型`, `Opus 模型`. Codex runtime shows `默认模型` and `推理强度`.

- [x] **Step 3: Keep UI copy Chinese**

Replace any new user-facing text with Chinese labels. Avoid extra explanatory text inside the app beyond field labels and empty states.

### Task 4: Agent Deployment Profile Binding UI

**Files:**
- Modify: `ui/src/components/agent-square/DeployTemplateModal.tsx`
- Modify: `ui/src/pages/AgentSquare.tsx` if the callback type needs widening

- [x] **Step 1: Load model profiles in the deploy modal**

Use `useModelStore` to fetch profiles. Filter profiles by selected runtime.

- [x] **Step 2: Add model profile selector**

Insert `模型档案` below `运行时`. Options include `不绑定模型档案` plus enabled profiles for the selected runtime. When runtime changes, clear incompatible selected profile.

- [x] **Step 3: Send profile binding on deploy**

Include `modelProfileId` in the deploy payload when selected.

### Task 5: Verification

**Files:**
- Modify documentation only if the final implementation adds stable architecture behavior beyond UI/data persistence.

- [x] **Step 1: Run tests**

Run: `npm test -- tests/unit/model-profiles.test.ts`
Expected: PASS.

- [x] **Step 2: Run full checks required by repo guidance**

Run: `npm test`, `npm run build`, and `npm run lint`.
Expected: PASS or report exact pre-existing failures.

- [x] **Step 3: Inspect diff**

Run: `git diff --check` and `git status --short`.
Expected: no whitespace errors; report all modified files and note pre-existing unrelated changes.
