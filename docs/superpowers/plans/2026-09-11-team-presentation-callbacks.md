# 团队会话展示回调补齐

## 目标

让团队会话复用普通 Agent 的文件交付、HTML 原型预览和 Markdown 资源打开能力。

## 实施清单

- [x] 对比普通 Agent 与团队页面的 ConversationPane 回调接入，确认所有遗漏。
- [x] 补齐团队页面的预览、文件展示和资源打开回调，复用 Workspace 现有实现。
- [x] 增加团队历史展示回归测试，覆盖文件和预览卡片；资源回调同时接入共享消息渲染。
- [x] 运行测试、构建、lint 和差异检查。
- [x] 自审后提交并合并到本地 prd，不重启服务。

## 验收标准

团队消息中的 `files.present` 可打开文件预览，`preview.publish` 可打开原型预览，Markdown 文件路径可使用现有资源打开逻辑；普通 Agent 行为不变。

## 审查结果

- 团队页面原先漏传 `onOpenFiles`、`onOpenPreview`、`onOpenResource`；现已由 Workspace 统一传入，复用已有文件弹窗、原型预览弹窗和资源解析链路。
- 文件弹窗原先属于普通 Agent 子组件，已提升到 Workspace，使团队和普通 Agent 共用同一个展示容器。
- 团队适配器原先的 `loadProcessItemDetail` 是空实现；现已调用 `sessions.processItemDetail`，并按团队消息源映射更新详情加载状态。
- 回归测试覆盖团队历史消息同时渲染文件交付卡和 HTML 原型卡。
- 全量测试：455 个文件、2534 个用例通过；`npm run lint`、TypeScript 检查、`npm run build`、`git diff --check` 通过。
- 构建仅有既有的前端 chunk 体积提示；无数据库、后端协议或移动端代码改动。
