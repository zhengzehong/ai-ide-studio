# PRD Start Script Fresh Build Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure the PRD local runtime never serves stale `ui/dist` assets and replaces an existing 18900 process before starting.

**Architecture:** Keep the fix in the PRD local startup boundary. The script builds the latest server/frontend bundle first, then stops any existing listener on the selected PRD port, then starts `node dist/entry.js` with the existing PRD data/log/static environment.

**Tech Stack:** PowerShell startup script, Vitest text regression for the script contract.

---

### Task 1: Lock the startup contract with a failing test

**Files:**
- Create: `tests/unit/prd-start-script.test.ts`
- Modify: none

- [ ] **Step 1: Write the failing test**

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = join(process.cwd(), 'scripts', 'start-prd-local.ps1')

function readScript(): string {
  return readFileSync(scriptPath, 'utf8')
}

describe('PRD local start script', () => {
  it('builds fresh assets before starting the local instance', () => {
    const script = readScript()

    expect(script).toContain('npm run build')
    expect(script.indexOf('npm run build')).toBeLessThan(script.indexOf('npm start'))
  })

  it('replaces an existing listener on the selected PRD port', () => {
    const script = readScript()

    expect(script).toContain('Stop-Process')
    expect(script).not.toContain('ERROR: port $($env:PORT) is already in use')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/unit/prd-start-script.test.ts`
Expected: FAIL because the script does not yet contain `npm run build` or `Stop-Process`.

### Task 2: Update the PRD start script

**Files:**
- Modify: `scripts/start-prd-local.ps1`

- [ ] **Step 1: Build before start**

Add a build step before `npm start`:

```powershell
Write-Host "Building latest code..."
npm run build
Write-Host ""
```

- [ ] **Step 2: Replace an old listener on the selected port**

Replace the current hard error on occupied port with process stopping and a post-stop check.

- [ ] **Step 3: Run the focused test and verify it passes**

Run: `npm test -- tests/unit/prd-start-script.test.ts`
Expected: PASS.

### Task 3: Rebuild, restart, and browser-smoke streaming

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full verification**

Run: `npm test`, `npm run build`, `npm run lint`, `git diff --check`.

- [ ] **Step 2: Restart PRD with the script**

Run: `.\scripts\start-prd-local.ps1` from `D:\code_space\python_space\ai-ide-studio-prd`.

- [ ] **Step 3: Browser smoke test**

Open `http://127.0.0.1:18900/workspace`, create a Code Engineer session, send a short prompt, and verify the page receives `session:update` `contentDelta` messages while the assistant bubble updates before `session:done`.

