# Claude 模型主动读图策略实施计划

## 目标

在模型档案中增加“允许 Agent 主动读取图片”开关。默认禁止 Claude Code 使用 `Read` 读取图片和 PDF；明确开启的视觉模型档案不注入限制。用户主动上传图片和 ACP `image` 能力保持不变。

## 实施步骤

1. 扩展 Claude 模型档案配置类型，增加 `allowImageRead` 布尔值并保持在现有 `config_json` 中。
2. 为禁止策略建立集中维护的 `Read` 权限规则，并通过 ACP session meta 注入 `permissions.deny`。
3. 将策略纳入 runtime 指纹，确保切换开关后 Claude runtime 使用新配置。
4. 在模型档案编辑器增加开关，并在档案列表显示当前策略。
5. 补充单元测试，覆盖默认禁止、显式禁止、显式放行和现有环境配置。
6. 更新 README 与架构数据模型文档。
7. 运行 `npm test`、`npm run build`、`npm run lint` 和 `git diff --check`。
8. 审查最终差异，修正后提交并合并到 `prd`。

## 验收标准

- 未配置或配置为 `false` 的 Claude 模型档案会注入图片 `Read` deny 规则。
- 配置为 `true` 时不注入图片 `Read` deny 规则。
- 用户上传图片和 ACP `promptCapabilities.image` 不受影响。
- 切换策略会改变 runtime 指纹。
- 前端可创建和编辑该开关，默认关闭。
- 所有必需验证通过且提交只包含本需求文件。
