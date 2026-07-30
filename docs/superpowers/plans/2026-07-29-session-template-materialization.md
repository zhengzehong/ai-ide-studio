# Claude 会话模板持久化实施方案

## 目标

修复 Claude 会话模板的惰性 fork：ACP 返回了模板 Session ID，但未发送 Prompt 时 Claude Code 不生成目标 JSONL，导致 Runtime 重启后模板无法再次 fork 或 resume。

本方案保持现有产品语义和接口不变：

- 发布模板仍调用 ACP `unstable_forkSession`。
- 模板仍绑定原 Agent 和原项目。
- 从模板新建仍返回一个普通 Session。
- PC、APP 和工具调用参数均不变化。

## 推荐方案

在 Runtime 的 Claude fork 路径中增加“同步物化”阶段：

```text
ACP fork(sourceAcpId)
  -> 返回 targetAcpId（此时仅有内存 Query）
  -> 定位 sourceAcpId.jsonl
  -> 逐行结构化改写顶层 sessionId
  -> 复制 sourceAcpId/ 伴随资源目录
  -> 临时文件/目录校验
  -> 原子发布 targetAcpId.jsonl 和 targetAcpId/
  -> 注册 Runtime Session
  -> 返回 API，数据库写入 targetAcpId
```

只有物化完成后，`forkSession` 才算成功。这样模板创建成功即代表它能够跨 Runtime/ACP 重启恢复。

## 为什么不只在 API 层复制

Runtime 子进程拥有 ACP Query 和 fork 生命周期。物化必须和 ACP fork 成为同一个成功/失败边界，否则会出现：

- API 已写数据库，但 Runtime 还没完成文件复制。
- Runtime 复制失败，API 不知道需要关闭哪个 ACP Query。
- 将来 Runtime 远程化后，API 所在机器不一定拥有 Claude 存储目录。

因此，新模板的正常物化放在 Runtime service；API/core 只处理旧模板自愈和业务回滚。

## 文件格式规则

### 主 JSONL

- 目标文件名：`<targetAcpSessionId>.jsonl`。
- 每行使用 `JSON.parse` / `JSON.stringify`。
- 仅改顶层 `sessionId`；若存在顶层 `session_id` 也改写。
- 当前模板只能在同项目使用，因此 `cwd` 保持不变。
- 未来支持跨项目模板时，再显式传 `sourceCwd/targetCwd` 并改写顶层 `cwd`。

禁止全文替换以下内容：

- 消息正文和 thinking。
- 工具输入输出里的绝对路径。
- `uuid`、`parentUuid`、`logicalParentUuid`、`promptId`。
- 历史 `gitBranch`。

### 伴随资源

若源目录 `<sourceAcpSessionId>/` 存在，复制为 `<targetAcpSessionId>/`：

- `tool-results/` 按字节复制。
- `subagents/` 完整复制，保留子 Agent 自己的事件图。
- 复制后核对主 JSONL 中的 `persistedOutputPath` 引用所需文件存在。

资源缺失时：

- 主 JSONL 无对应引用：允许继续。
- 主 JSONL 明确引用但源文件不存在：fork 失败，不能发布残缺模板。

## 一致性与原子性

1. 打开源 JSONL 后记录文件长度，只读取该长度，形成确定的快照边界。
2. 最后一行必须是完整 JSON；遇到正在追加的半行时短暂重试，不截断伪造。
3. 先写 `<target>.jsonl.tmp-<uuid>`。
4. 伴随资源先写 `<target>.tmp-<uuid>/`。
5. 校验记录数、所有顶层 Session ID、目标 cwd 和资源引用。
6. 使用同卷 rename 发布；主文件和资源任一步失败则删除全部临时产物。
7. 若 ACP fork 已成功但物化失败，Runtime 调用 `closeSession(targetAcpId)` 并从内存移除目标 Session。

## 发布流程改造

`src/core/session-templates.ts` 的业务顺序保持：

1. 校验源 Session。
2. 创建 `is_template=1` placeholder Session。
3. 调用 Runtime `forkSession`。
4. Runtime 完成 ACP fork + 文件物化。
5. API 保存模板 Session 的 `acp_session_id`。
6. 创建 `session_templates` 记录。

第 4 步失败时沿用现有回滚：关闭 Runtime Session、删除 placeholder，不创建模板记录。

## 实例化流程改造

正常的新模板：

1. 模板 ACP JSONL 已存在。
2. Runtime 从模板 ACP ID fork 新 ID。
3. Runtime 同步物化新 ID。
4. API 写新 Session 的 `acp_session_id`，再增加 `use_count`。

这样新建 Session 即使尚未发送第一条 Prompt，也能在重启后 resume。

## 已有坏模板自愈

当前数据库可能已有“有 `acp_session_id`、无 JSONL”的模板。实例化前做一次 Claude-only preflight：

1. 检查模板 ACP JSONL 是否存在。
2. 存在：正常继续，不重复复制。
3. 不存在：读取 `source_session_id` 对应源 Session 的 `acp_session_id`。
4. 源 JSONL存在：按发布规则物化到既有模板 ACP ID，记录 `legacy template snapshot repaired` 日志。
5. 源也不存在：返回明确错误“模板快照和源会话均不可恢复，请重新发布模板”，不创建新 Session。

自愈只针对历史模板；新模板必须在发布事务内完成物化。

## 删除与回滚

平台开始主动创建目标 JSONL 后，也必须负责清理：

- 删除模板：先关闭 ACP Session，再删除模板 JSONL 和同名资源目录，最后删除数据库记录。
- 发布/实例化失败：删除目标临时文件和已发布的目标文件，不删除源文件。
- 文件删除遇到占用：有限重试；最终失败则保留模板记录并返回错误，避免数据库显示已删除但磁盘资产泄漏。
- 所有删除目标必须校验位于 Claude `projects` 根目录内，且 Session ID 符合 UUID 格式。

## Runtime 差异

- `claude`：启用 JSONL 物化和旧模板自愈。
- `codex`：继续使用原生 `thread/fork` 持久化，不操作 Claude 文件。
- `mock`：保持现状。

## 代码改动

预计 8–11 个文件，拆成 3 个提交。

### 提交 1：Claude 文件存储适配器

- 新增 `src/acp/claude-session-files.ts`。
- 提供 locate、clone、validate、remove API。
- 新增 `tests/unit/claude-session-files.test.ts`。
- 覆盖同 cwd、结构化 Session ID 改写、半行、资源引用、原子回滚、路径逃逸。

### 提交 2：Runtime fork 同步物化

- 修改 `src/runtime/service/sdk-runtime-host.ts`，或将 fork 逻辑拆到 `sdk-runtime-fork.ts`，避免超过 400 行。
- ACP fork 后调用 Claude 文件适配器，物化失败时关闭内存 Query。
- 更新 `tests/unit/sdk-runtime-host-lifecycle.test.ts`。
- 更新 `tests/integration/runtime-process.test.ts`，验证 fork 后杀 Runtime、重启后仍可 resume。

### 提交 3：旧模板自愈和删除

- 修改 `src/core/session-templates.ts`。
- 实例化前检查/修复旧模板快照。
- 删除模板时清理平台创建的 Claude 文件。
- 更新 `tests/integration/session-templates-core.test.ts`。
- 更新 `docs/design/session-template.md`，删除“fork 自动复制成新文件”的错误描述。

## 数据库

首版不需要 migration：

- 模板记录只在 Runtime 物化成功后创建。
- snapshot readiness 由目标 JSONL + 校验结果决定。
- 旧模板通过 `source_session_id` 做按需修复。

若未来要支持模板导出、跨机器同步或多版本快照，再新增独立 snapshot 表记录 hash、格式版本、大小和存储 URI。

## 验收标准

1. 发布模板后不发送 Prompt，目标 JSONL 已存在且可由新 ACP 进程 resume。
2. 重启 Runtime 后，模板可连续实例化两次。
3. 从模板新建后不发送 Prompt，重启 Runtime 后新 Session 也可 resume。
4. 具备 `tool-results/` 和 `subagents/` 的模板资源完整。
5. 物化失败不留下模板 DB 记录、目标 JSONL、资源目录或 ACP Query。
6. 旧坏模板在源会话仍存在时自动修复；源也丢失时返回明确错误。
7. 删除模板会清理平台创建的 Claude 文件，不触碰源 Session。
8. Codex、mock 和普通 Session 路径行为不变。
9. `npm test`、`npm run build`、`npm run lint`、`git diff --check` 通过。

## 风险

- Claude JSONL 是私有格式：适配器必须集中封装并带格式校验，不能把路径规则散落到 core/runtime。
- 发布时源会话可能仍在写：必须按固定文件长度读取并验证完整 JSON 行。
- 大型伴随资源复制会增加发布时间：UI 保留现有“正在生成模板会话”阶段提示，后续可增加字节进度，不影响首版正确性。
- 跨项目模板仍可能在历史正文中包含旧路径：首版继续禁止跨项目实例化，不能通过全文替换解决。
