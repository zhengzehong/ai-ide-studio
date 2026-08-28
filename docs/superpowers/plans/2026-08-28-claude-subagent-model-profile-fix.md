# Claude 子 Agent 模型档案覆盖修复计划

## 目标

Claude Agent 绑定固定或全局模型档案后，Claude Code 子 Agent 不得被用户级 `CLAUDE_CODE_SUBAGENT_MODEL` 覆盖；未显式指定模型时继承档案主模型，显式指定 Haiku/Sonnet/Opus 时继续使用档案对应映射。

## 改动范围

1. 在 `src/acp/model-profile-env.ts` 中由 Claude 档案将 `CLAUDE_CODE_SUBAGENT_MODEL` 重置为 `inherit`。
2. 将该变量加入 Claude session settings env 白名单、Runtime 指纹和安全环境摘要。
3. 在 `tests/unit/model-profile-env.test.ts` 覆盖基础环境污染、session meta 透传和指纹变化。

## 验收标准

- 基础环境强制设置 DeepSeek 子 Agent 模型时，档案能够重置为 `inherit`，使默认子 Agent 继承档案主模型。
- 主模型和 Haiku/Sonnet/Opus 映射行为不变。
- 子 Agent 模型变化会触发不同 Runtime 指纹。
- 不修改数据库、RPC、UI 或 PRD 运行状态。
- `npm test`、`npm run lint`、`npm run build`、类型检查和 `git diff --check` 通过。
