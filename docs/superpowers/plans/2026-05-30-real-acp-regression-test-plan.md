# 真实 Claude Code / Codex ACP 回归测试计划

日期：2026-05-30

## 目标

在当前代码基础上验证真实 `claude-agent-acp` 与 `codex-acp` 的平台接入状态，确认不只 mock 可用：runtime 启动、ACP 初始化、Local Session 到 ACP Session 映射、prompt 流式事件、工具/usage/能力事件、消息与事件持久化，以及失败原因是否可观测。

## 范围

1. 使用独立测试数据目录，不污染现有 `data/ai-ide.sqlite`。
2. 优先走 WS 自动化，避免 UI 操作误差。
3. Claude Code 与 Codex 分开测试，分别记录：
   - runtime 命令是否存在。
   - 初始化是否成功。
   - session 创建是否成功。
   - prompt 是否完成。
   - `messages` 是否持久化 human/agent。
   - `session_events` 是否包含关键事件。
   - `session.getModels` 是否返回模型/模式/命令/配置能力。
4. 如果某个 runtime 因认证、额度或本机 CLI 状态失败，本轮只定位并报告失败边界，不伪造通过。

## 测试步骤

1. 预检 runtime
   - 检查 `node_modules/.bin/claude-agent-acp.cmd`、`node_modules/.bin/codex-acp.cmd`。
   - 检查系统 `claude`、`codex` 命令是否可见。
   - 读取项目 runtime 解析结果。

2. 启动独立服务
   - `DATA_DIR=.tmp-real-acp-data`
   - `PORT=18800`
   - `HOST=127.0.0.1`

3. Claude Code WS 回归
   - 创建项目。
   - 创建 runtime=`claude` 的项目 Agent。
   - 创建 session 并 subscribe。
   - 发送一个低风险 prompt：只要求简短回复，不主动写文件。
   - 等待 `session:done` 或明确 error。
   - 查询 `sessions.messages`、`sessions.events`、`session.getModels`。

4. Codex WS 回归
   - 同 Claude 步骤，但 runtime=`codex`。
   - 若本机 Codex provider/认证缺失，记录具体 stderr / WS error。

5. UI 抽测（如 WS 通过）
   - 打开 Workspace。
   - 选择真实 runtime 会话。
   - 确认历史文本可见，不要求重复消耗模型。

## 验收标准

- 每个 runtime 需要明确输出：通过 / 失败 / 阻塞。
- 通过条件：至少一轮 prompt 完成，human + agent 消息持久化，events 可查询。
- 失败条件：给出具体错误边界，如命令缺失、认证失败、初始化失败、prompt 超时、事件缺失。
- 不修非本轮发现的问题；如发现真实 bug，先补最小复现再修。
