# /updates 对话输入区与 Workspace 对齐计划

## 目标

让 `/updates` 中间对话区域底部输入卡的结构、工具栏和交互状态与 Workspace 的 `WorkspaceChatPane` 保持一致，同时不替换或修改 Workspace 页面自身。

## 边界

- 修改通用 `ConversationComposer` 及其样式，使 `/updates` 复用同一套输入区能力。
- 复用现有文件附件、菜单和用量相关类型/工具；新增轻量 `conversation-drafts` 存储以保证异步附件按会话回写，不新增后端接口。
- 不修改 `Workspace.tsx`、后端、移动端和全局 CSS。
- 保留现有 `ConversationPane` adapter 边界，发送、停止、模型/模式/配置切换继续走已有回调。

## 实施步骤

1. 对照 Workspace 输入卡，补齐通用 Composer 的每会话草稿、图片预览与删除、文件状态、拖拽/粘贴、发送/停止/阻塞状态。
2. 将原生 select 工具栏替换为 Workspace 同款按钮和 Portal 菜单，保留能力到达前后的空态。
3. 将 Composer CSS 调整为 Workspace 的卡片、textarea、工具栏、按钮和附件布局，确保窄栏下溢出可控。
4. 增加 ConversationPane/Composer 定向测试，验证渲染出口、能力菜单、附件和状态按钮。
5. 运行定向测试、全量 lint、TypeScript 和 build，审查改动边界后提交独立分支。
6. 将图片 blob URL 在删除、发送完成、草稿清理和过期回收时释放，并覆盖跨会话异步上传回归测试。

## 验收标准

- `/updates` 输入卡使用 Workspace 同款 12px 圆角、边框、阴影、56px 起始 textarea、32px 圆形发送/停止按钮。
- 命令、模式、配置、模型使用按钮+菜单，不再使用简化原生 select。
- 每个会话的草稿、图片缩略图/删除、文件上传状态和错误状态可保留并展示。
- 切换会话期间完成的图片读取/文件上传仍回写原会话草稿，草稿图片资源不会无限占用内存。
- Workspace 页面行为和文件无改动；后端零改动。
- 定向测试、TypeScript、lint、build 通过。
