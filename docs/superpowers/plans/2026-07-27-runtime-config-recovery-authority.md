# Runtime 配置持久化与 Recovery 权威顺序实施计划

## 目标

修复 process Runtime 中用户确认的 Session 配置只广播、不持久化，导致 HTTP Recovery 用历史 `config.update(default)` 覆盖实时 `effort=max` 的问题。

## 实施步骤

1. 为 `SdkRuntimeHost` 增加失败测试，要求手动 `setConfig` 和 Session 偏好应用完成后发布可持久化的最终配置快照。
2. 恢复 embedded Runtime 已有的 `session:update(configOptions)` 行为，并保证最终快照位于初始化中间状态之后。
3. 为 PC Session store 增加配置新鲜度保护测试，历史 Recovery 只能作为初始化兜底，不能覆盖更新的 `fetchModels`、实时 capabilities 或用户确认值。
4. 调整 Session store 的配置合并和 Session 选择请求隔离，保留动态选项定义。
5. 运行定向测试、全量测试、lint、build 和 `git diff --check`。

## 验收标准

- `setConfig(effort=max)` 产生最终 `config.update(max)` 持久化更新。
- Session 初始化默认 Max 后，最新可恢复配置为 Max。
- `fetchModels(max)` 先到、Recovery(default) 后到时，界面仍保持 Max。
- 导航、重连和 prompt 完成后不再把 Max 显示成默认。
- 无数据库 migration，不重启 PRD。
