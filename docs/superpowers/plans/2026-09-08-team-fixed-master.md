# 固定 Team Master 与创建入口

## 目标

创建团队时使用内置 Team Master 模板，默认提示词可在创建表单中调整；Master Agent 隐藏于普通 Agent 列表，并自动获得团队编排工具。

## 实施

1. 为 `teams` 增加 `master_prompt`，服务层创建专属 Master Agent 并保存提示词。
2. 创建团队时自动部署 `tpl-team-leader`、隐藏 Agent、绑定 `team-leader` Profile。
3. Team Master 使用群聊成员 Session，不改变普通 Agent Workspace。
4. Workspace 左侧团队分组增加创建按钮和弹窗，提交后刷新团队列表并选中新团队。
5. 保留 `team.create` 工具作为兼容入口，但改用固定 Master 逻辑。
6. 移除 Team 工具的全局静态屏蔽，继续依赖无全局绑定的 Agent Profile 做精确暴露。
7. 新建 Master/成员写入 `teamInternal` 标记并从普通 Agent 列表排除；复用已有 Agent 时不改变其可见性。

## 验收

- 默认提示词自动填充且可修改。
- 新团队 Master 不出现在普通 Agent 列表。
- Master 的团队工具绑定完整，且团队上下文按 Session 注入。
- Workspace 普通 Agent、现有 Team 会话和消息链路无回归。
- migration、tsc、lint、build 和团队测试通过。
