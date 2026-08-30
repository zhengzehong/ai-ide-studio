# 禁用 Claude Code 内置调度工具实施计划

## 目标

在 Claude ACP Session 的统一配置中禁用 `Workflow`、`CronCreate`、`CronDelete`、`CronList`、`ScheduleWakeup` 和 `AskUserQuestion`，避免 Claude 绕过 AI IDE Studio 的任务、排班、唤醒和请示机制。

## 改动清单

1. 在 `buildAgentSessionMeta` 的 Claude 配置中加入共享 `disallowedTools` 常量。
2. 确认 Codex Session Meta 不携带该配置。
3. 补充单元测试，覆盖 Claude 配置、无模型环境和 Codex 边界。
4. 更新系统提示词，说明任务/排班/唤醒/确认应使用平台能力。

## 验收标准

- Embedded Runtime 和 Process Runtime 创建的 Claude Session 都收到六项黑名单。
- SDK/ACP 不会把六项工具暴露给模型，也不会允许调用。
- Codex 行为不变。
- 定向测试、全量测试、构建、Lint 通过。
- 不涉及数据库迁移，不重启 PRD 服务。
Addendum: WebSearch and WebFetch are also disabled. The Claude blacklist now contains eight tools.
