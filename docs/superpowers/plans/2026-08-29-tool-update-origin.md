# Platform Tool Update Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent platform reconciliation and synthetic tool updates from demoting an already emitted final reply while preserving tool result persistence.

**Architecture:** Carry an internal `SessionUpdateSource` on the event envelope. ACP/runtime-originated tool events retain the existing boundary behavior; platform reconciliation and synthetic fallback events are marked explicitly and only merge tool state. The source is internal and is not persisted in the public WS payload.

**Tech Stack:** TypeScript, mitt event bus, Vitest, better-sqlite3.

## Tasks

- [x] Add a regression test reproducing final text followed by a synthetic platform presentation update.
- [x] Add typed source propagation to the event bus and runtime ingress.
- [x] Make both turn finalization paths suppress demotion for platform-originated updates.
- [x] Run targeted and full verification, review the diff, and commit on `prd`.

## Acceptance Criteria

- A platform reconciliation or synthetic update never demotes `finalAnswer`.
- A genuinely new ACP tool event still demotes preceding text.
- Existing presentation delivery and history persistence tests remain green.
- No database migration, service restart, or online database access.
