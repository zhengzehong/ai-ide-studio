# PC 项目灵感工作台实施计划

## 目标

为每个项目提供一个 PC 端灵感工作台。用户可以先保存原始灵感，再由一个项目级长期会话自动整理为摘要、Markdown 方案和多个候选任务；候选任务经过人工确认后可以只创建或立即派发。

## 范围

- 新增项目灵感配置、灵感记录和候选任务数据。
- 新增项目级长期灵感 Session，自动整理与人工讨论共享上下文。
- 新增 `inspiration.analysis.publish` 内置工具，持久化结构化整理结果。
- 新增灵感 RPC、事件和 PC Zustand Store。
- 新增 PC 项目导航和双栏工作台页面。
- 候选任务支持编辑、只创建、立即执行、打开 Task 和执行 Session。
- 首期支持 Markdown 文本和图片附件引用，不引入富文本编辑器依赖。
- 不修改 `mobile/`，不构建 APK，不重启 PRD 服务。

## 数据设计

### project_inspirations

每个项目唯一一行：

- `project_id` 主键
- `session_id` 唯一，可为空
- `organizer_agent_id`，可为空
- `organization_prompt`
- `auto_organize`
- `last_error`
- `created_at` / `updated_at`

### inspiration_notes

- 原文：`title`、`source_markdown`、`attachments_json`
- 整理状态：`status`、`analysis_revision`、`summary`、`body_markdown`、`questions_json`、`last_error`
- 时间：`created_at`、`updated_at`、`organized_at`

### inspiration_candidates

- 归属：`note_id`、`analysis_revision`、`sort_order`
- 内容：`title`、`description_markdown`
- 推荐：`suggested_agent_id`、`agent_reason`
- 执行关联：`task_id`、`execution_session_id`
- 时间：`created_at`、`updated_at`

当前结果只读取与 `note.analysis_revision` 一致的候选任务；旧版本保留用于审计。

## 后端步骤

1. 新增 migration 052 和三组 Store，补迁移及 CRUD 单元测试。
2. 新增 inspiration service：配置、Session 初始化、保存、重新整理、重启恢复、AI 结果发布和任务创建。
3. 自动整理按项目串行执行；note 状态承担队列，不增加 runs 表。
4. AI 发布使用 `noteId + expectedRevision` CAS，旧结果不得覆盖新版本。
5. 候选任务创建按 candidateId 幂等；只创建使用 Task + Step，立即执行复用 `createSimpleTask`。
6. 新增 `inspiration.analysis.publish`，仅允许被对应项目灵感 Session 调用。
7. 新增 RPC 和 WS 类型，所有入口校验 owner、项目、Agent、Session 和长度边界。

## PC 步骤

1. 新增 `/p/:projectId/inspiration` 路由和项目导航入口。
2. 新增独立 Store，加载配置、记录、详情并监听 `inspiration:update`。
3. 页面拆为列表、编辑器、Markdown 结果、候选任务、确认抽屉和设置弹窗。
4. 未配置 Agent 时允许保存；触发整理时提示配置。
5. 图片复用现有 Session 文件上传；首期编辑正文使用 Markdown textarea，避免不可靠的原生 contenteditable。

## 测试

- migration 幂等和外键。
- 保存、revision、CAS、失败恢复和重启重排队。
- 工具仅在正确 Session 可用，输入边界完整。
- 候选任务只创建、立即执行和重复点击幂等。
- RPC 权限和项目隔离。
- PC 页面状态、候选操作和导航。
- `npm test`、`npm run lint`、`npm run build`、`npx tsc --noEmit`、`git diff --check`。

## 文档

- 更新 `docs/architecture/data-model.md`。
- 更新 `docs/architecture/ws-protocol.md`。
- 更新 `docs/architecture/overview.md`。
- 更新 `README.md`。

## 验收标准

- 一个项目只有一个灵感配置和一个当前长期会话。
- 原文保存不依赖 AI 成功，刷新后仍在。
- AI 晚回的旧 revision 无法覆盖新内容。
- 一个候选任务最多关联一个 Task。
- 整理 Agent 不能绕过候选确认直接通过本功能派发任务。
- PC 可完成记录、整理、查看、调整、创建和派发闭环。
- `mobile/` 零改动，PRD 在线服务未重启。
