# 团队会话列表状态与视觉对齐

## 目标

- 不再使用团队会话 `status=active` 作为“正在运行”判断。
- 使用 master session 的真实 `runningSessionIds` 与 `activity_state` 显示运行点。
- 让团队会话列表的头部、行间距、选中态和操作按钮与个人 `SessionBar` 保持一致。
- 不修改后端、数据库或普通 Workspace 会话逻辑。

## 实施步骤

1. 为 `TeamConversationList` 增加运行态映射 prop，并在 `Workspace` 注入现有 session store 状态。
2. 复用 `SessionBar` 的尺寸和颜色 token，保留团队专属的新建、重命名、归档、删除行为。
3. 增加团队列表状态回归测试，覆盖 active/idle、真实 running、归档会话和视觉关键样式。
4. 运行定向 Vitest、UI TypeScript、lint、build，检查 diff 和工作树后提交。
