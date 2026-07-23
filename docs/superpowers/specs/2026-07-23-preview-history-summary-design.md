# Preview History Summary Design

## Goal

Keep `preview.publish` cards visible after PC refresh, PC session switching, and mobile session re-entry without restoring full tool-call payloads into normal message history.

## Current Behavior

During an active turn, PC and mobile render preview cards from realtime `session:update` tool-call blocks. Completed tool details are stored in `turn_process_items`, while `messages.tool_calls_json` is intentionally cleared to keep history lightweight. On history reload, completed process items are loaded only after the user expands the process panel, so the preview card is absent until that lazy load occurs.

## Design

Add a nullable `presentations_json` column to `messages`. It stores only small, user-facing presentation summaries. The first supported presentation kind is `preview`:

```json
[
  {
    "kind": "preview",
    "previewId": "prev-123",
    "url": "/preview/prev-123/",
    "title": "Page preview",
    "target": "pc",
    "taskId": null,
    "createdAt": "2026-07-23T00:00:00.000Z"
  }
]
```

At turn completion, the backend extracts valid `preview.publish` outputs from finalized tool calls and writes only these summaries to the message row. Existing `tool_calls_json` and `turn_process_items` behavior remains unchanged.

Message history returns `presentations_json` through both the HTTP query path used by PC and the existing `sessions.messages` RPC used by mobile. Both clients parse the summaries and render preview cards independently of `processBlocks`. During a live turn, cards continue to use realtime tool-call blocks.

To avoid duplicate cards when a just-completed turn temporarily contains both realtime process blocks and persisted summaries, the clients deduplicate by `previewId` and prefer the realtime block until it is cleared.

## Existing Data

Migration 047 adds the nullable column and backfills old preview records by selecting only tool process rows whose `title` exactly matches one of the two supported `preview.publish` tool names. It does not parse unrelated tool details, so migration cost is bounded by the small preview subset rather than accumulated tool output. All previews completed after the migration persist summaries automatically.

## Scope

Included:

- New preview summary parser shared by backend behavior and mirrored client types.
- Persistence on message append/finalization/copy.
- PC history rendering.
- Mobile history rendering.
- Realtime/history deduplication.
- Migration, unit, integration, PC, and mobile regression tests.

Excluded:

- New file presentation tool.
- Full historical preview backfill.
- Changes to ACP, Runtime, Realtime transport, Writer batching, or prompt execution.

## Failure Handling

Malformed, failed, or incomplete preview tool results produce no summary. History continues to render the final answer and process count normally. A missing preview entity still produces the existing preview-open error behavior and does not break the conversation.
