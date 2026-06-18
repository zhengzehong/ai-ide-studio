# Event Subscription Filter Normalization Plan

**Goal:** Prevent event subscription tools from silently treating misplaced payload filters such as `{ "taskStatus": "backlog" }` as empty filters.

**Success criteria:**
- `event.subscription.create` normalizes category payload fields into `filter.payload`.
- Unknown top-level filter keys fail fast instead of being saved and ignored.
- Subscription detail UI displays payload filters instead of reporting "match all".
- Focused tests, lint, build, and diff checks pass.

## Steps

- [x] Add failing backend/tool tests for flat payload filters and unknown filter keys.
- [x] Add failing UI coverage for rendering payload filter rows.
- [x] Implement filter normalization in event subscription creation and legacy matching.
- [x] Tighten tool schema/description and seed metadata.
- [x] Render payload filters in the subscription detail panel.
- [x] Run focused tests, lint, build, full tests, and review diff.
- [x] Commit one focused change and cherry-pick it to local `prd`.
