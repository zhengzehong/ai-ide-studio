# Mobile Session Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile Agent chip rail with dropdown filtering beside the project picker, and add status/sort filters for the mobile session list.

**Architecture:** Keep filtering and sorting client-side because `sessions.list` already returns the fields needed by the mobile list. Add a small pure utility for filter/sort behavior, then keep `SessionListPage` responsible for composing UI state and rendering. Reuse the current bottom-sheet dropdown style to avoid changing the backend protocol or desktop UI.

**Tech Stack:** React 19, Vite mobile app, Zustand stores, Vitest unit tests.

---

### Task 1: Filter/Sort Utility

**Files:**
- Create: `mobile/src/utils/session-list-filters.ts`
- Create: `tests/unit/mobile-session-list-filters.test.ts`

- [x] Write failing tests for default recent-activity sorting, Agent filtering, running filtering, and unread filtering.
- [x] Implement `filterAndSortMobileSessions`.
- [x] Run the focused utility test.

### Task 2: Dropdown Filter UI

**Files:**
- Create: `mobile/src/components/FilterSelectSheet.tsx`
- Delete or stop using: `mobile/src/components/AgentFilterChips.tsx`
- Modify: `mobile/src/pages/SessionListPage.tsx`

- [x] Add a reusable compact sheet selector for project and Agent filters.
- [x] Place Agent selector beside project selector, defaulting to all Agents.
- [x] Add compact status filter buttons and sort selector above the list.
- [x] Remove the horizontal Agent chip rail from the page.

### Task 3: Verification and Commit

**Files:**
- Modify: this plan file.

- [x] Run focused mobile filter tests.
- [x] Run mobile lint and mobile build.
- [x] Run full build.
- [x] Review git diff and status.
- [x] Commit the change on `prd`.
