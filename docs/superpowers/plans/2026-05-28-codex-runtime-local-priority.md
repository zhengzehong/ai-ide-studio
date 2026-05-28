# Codex runtime 优先使用本地 Codex

## 目标
- Codex ACP 启动时先检测系统 `codex` 命令。
- 若可用，通过 `CODEX_PATH` 让 `codex-acp` 使用系统 Codex app-server。
- 若不可用，不阻塞，继续使用 `codex-acp` 自带 `@openai/codex` 兜底。
- 保持改动最小，不调整 UI 与其他 runtime。

## 步骤
1. 提取 Codex env 构造 helper -> 验证可单测。
2. 在 `startAgent` spawn env 中注入 helper 结果 -> 验证 Codex runtime 优先系统命令。
3. 增加单元测试覆盖检测成功/失败分支。
4. 运行测试/构建/格式检查。
