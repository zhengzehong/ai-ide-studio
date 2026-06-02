# Chat Session Resume Placeholder Fix Plan

**Goal:** Fix duplicate/stray "正在恢复会话..." bubbles in chat when selecting or sending messages in existing ACP sessions.

**Root cause:** Passive capability loading (`session.getModels`) resumes persisted ACP sessions and emits visible lifecycle updates. If the user sends while that stage-only bubble exists, the real assistant stream can keep the lifecycle message id instead of the ACP message id, making render reconciliation unstable.

## Task 1: Backend silent resume for passive session RPC

- [x] Add a lifecycle visibility flag to ACP session context.
- [x] Make `session.getModels`, `session.setModel`, `session.setMode`, and `session.setConfig` ensure ACP sessions silently.
- [x] Keep prompt send path visible so the user still gets immediate feedback.

## Task 2: Frontend stage placeholder id handoff

- [x] When real streaming data arrives with a message id, replace any stage-only streaming placeholder id with that real message id.
- [x] Keep existing streaming content behavior unchanged.

## Task 3: Verification

- [x] Add/adjust unit tests for silent lifecycle and stage placeholder handoff.
- [x] Run targeted tests.
- [x] Run build/lint or at least the smallest reliable validation for touched code.
