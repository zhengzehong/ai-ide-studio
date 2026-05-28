# MCP Tool Platform Doc Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old HTTP MCP tool platform documents with one clear architecture document focused on method-level tool visibility controlled by session tokens.

**Architecture:** This is a documentation-only change. The new document should describe a single long-running HTTP MCP gateway, platform functions registered as MCP tool methods, agent/project/session bindings that resolve visible tools, and token-based `tools/list` plus `tools/call` enforcement.

**Tech Stack:** Markdown docs in `docs/architecture`, existing AI IDE Studio TypeScript/SQLite architecture as context.

---

### Task 1: Replace old HTTP MCP docs with simplified architecture doc

**Files:**
- Delete: `docs/architecture/http-mcp-tool-platform.md`
- Delete: `docs/architecture/http-mcp-tool-platform-implementation.md`
- Create: `docs/architecture/mcp-tool-platform.md`

- [ ] **Step 1: Verify no external docs reference the old filenames**

Run:

```bash
rg -n "http-mcp-tool-platform|HTTP MCP 工具平台" docs src README.md AGENTS.md package.json
```

Expected: only the two old documents appear, or no references after deletion.

- [ ] **Step 2: Delete the two old documents**

Remove:

```text
docs/architecture/http-mcp-tool-platform.md
docs/architecture/http-mcp-tool-platform-implementation.md
```

- [ ] **Step 3: Write the new architecture document**

Create `docs/architecture/mcp-tool-platform.md` with these required sections:

```text
# MCP 工具平台架构设计
- 设计目标
- 一句话架构
- 核心概念
- 目录结构建议
- 平台功能如何发布成 MCP
- Agent 如何绑定 MCP 方法
- Token 如何控制工具可见性
- MCP 请求流程
- 数据模型建议
- 第三方 MCP 的处理原则
- 分阶段落地建议
- 设计边界
```

The document must explicitly state:

```text
第一版不做复杂 scopes/role 权限，只做方法级可见性。
tools/list 只返回 token 可见工具。
tools/call 必须再次检查 tool name 是否在 token visible tools 中。
平台功能注册为 ToolDefinition 后即可被 MCP Gateway 发布。
Agent 绑定的是具体 tool method，而不是只能绑定整个 MCP 服务。
```

- [ ] **Step 4: Verify the old docs are gone and the new doc exists**

Run:

```bash
Test-Path docs/architecture/http-mcp-tool-platform.md
Test-Path docs/architecture/http-mcp-tool-platform-implementation.md
Test-Path docs/architecture/mcp-tool-platform.md
```

Expected:

```text
False
False
True
```

- [ ] **Step 5: Search for stale references**

Run:

```bash
rg -n "http-mcp-tool-platform|HTTP MCP 工具平台实施方案|HTTP MCP 工具平台架构" docs src README.md AGENTS.md package.json
```

Expected: no output.

- [ ] **Step 6: Review git diff**

Run:

```bash
git diff -- docs/architecture/http-mcp-tool-platform.md docs/architecture/http-mcp-tool-platform-implementation.md docs/architecture/mcp-tool-platform.md docs/superpowers/plans/2026-05-28-mcp-tool-platform-doc-refresh.md
```

Expected: only the two old document deletions, the new architecture document, and this plan file.
