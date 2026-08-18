# 秘书管理工具与未读闭环实施计划

## 目标

- 普通项目会话中的 AI 可以管理当前项目秘书。
- 隐藏秘书 Session 不再污染普通会话未读统计。
- PC/APP 均能看到并打开秘书邮件、秘书对话的新提醒。

## 执行清单

- [x] 为工具可见性、CRUD 参数和项目边界添加测试。
- [x] 新增 `studio.secretary.list/get/create/update/delete` 内置工具。
- [x] 管理工具只对普通 `conversation` Session 可见，并从 ToolContext 注入项目。
- [x] 为秘书摘要增加 `chatUnread`，不改变现有邮件 `unreadCount` 语义。
- [x] 修复 PC 隐藏 Session 自动进入普通缓存和普通未读统计的问题。
- [x] 清理显式加载秘书 Session 离开后的临时状态。
- [x] PC 项目秘书导航、秘书列表和对话按钮显示未读提醒。
- [x] APP 秘书 Tab、秘书列表和对话按钮显示未读提醒。
- [x] 打开秘书对话后清除 `chatUnread` 并同步刷新。
- [x] 更新架构文档、WS 协议与 README。
- [x] 运行定向测试、全量测试、lint、build 和 diff 检查。

## 边界

- 不新增数据库迁移。
- 不改变普通会话未读语义。
- 不允许 AI 通过工具指定其他项目。
- 不允许秘书后台、秘书对话或自主工作 Session 使用管理工具。
- 删除工具要求秘书 ID 和当前名称同时匹配。
