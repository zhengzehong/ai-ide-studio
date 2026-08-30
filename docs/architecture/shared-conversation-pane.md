# Shared Conversation Pane

`ConversationPane` is the reusable PC middle conversation surface. It receives a store-agnostic `ConversationAdapter` and owns message rendering, scroll anchoring, history pagination, process/detail expansion, composer attachments, drafts, capability controls, usage display, and permission/elicitation states.

Workspace keeps its existing implementation and session store. The `/updates` page supplies an isolated adapter backed by `workbench-session.store`, so selecting or sending messages in the cross-project workbench does not change Workspace's current project or session.

The component uses existing query, command, WebSocket, file upload, Markdown, virtual list, and presentation APIs. No backend endpoint or database schema is required.
