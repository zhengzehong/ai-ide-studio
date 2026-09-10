# 团队身份与原生记忆升级

代码合并不会更改正在运行的服务。部署新后端时执行数据库迁移 069 和成员身份对账；请沿用项目现有备份与部署流程。

## 数据处理

- 新团队和新增成员直接使用专属 Agent，已有 Agent 仅作为定义来源。
- 旧团队复用的身份在启动恢复时分离。先清理服务重启遗留运行状态，再创建新成员身份和 Session，最后恢复团队唤醒。
- 旧消息、ACP 映射和记忆文件不覆盖。未完成任务的团队执行指针切到新身份，Master/成员启动提示词引用可归属的旧团队历史供交接。
- 未加入团队线的普通会话保留；多个成员共用且无法唯一归属的旧 Session 保留，团队通过任务和 mailbox 接续，不自动读取混合历史。执行中身份暂不迁移，函数返回 deferred 并记录日志；正常启动前已对账运行状态。
- 已结束的任务不改写；新联系持久化在 team_contacts，同一外部 Session 与团队复用一条联系。

## 原生记忆

Claude 使用 `DATA_DIR/agent-memory/<projectId|global>/<agentId>/claude/`。同一 Agent 的普通、团队格子或自主 Session 共享该 Agent 目录，不同 Agent 不共享。团队副本的新 ID 使其不读取源 Agent 的私人记忆。

Codex 的 memories 功能、生成和召回在 Runtime 配置中关闭；原来的平台 memory 工具仍可使用。用户的 `CLAUDE_CONFIG_DIR`、`CODEX_HOME`、登录信息和原生会话历史不搬迁。

旧项目原生记忆不批量复制或删除，因为内容无法可靠归属具体 Agent。已注入现有会话的内容不会被目录切换抹除。Agent 使用的文件工具仍遵守原有系统权限，这项隔离针对自动加载和写入，不是磁盘访问沙箱。

## 验收

普通 Agent 分别调用 core.agent.list 和 team.list；向团队发送消息后，确认落到 Master，并通过 targetSessionId 回到来源。重启后继续发送应复用同一联系。内部成员不能直发外部、普通 Agent 不能读取成员历史；用户团队工作区仍可查看全部成员过程。

查看 Runtime 快照的 Claude settings 或 Codex CODEX_CONFIG 确认策略已传入；新身份的首次对话不应自动召回源 Agent 的私人记忆。
