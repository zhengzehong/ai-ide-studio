# 主链路对话完整测试计划

日期：2026-05-30

## 目标

验证 AI IDE Studio 的 Workspace 对话主链路是否真正可用：项目选择、Agent 会话创建、prompt 发送、流式输出、完成态持久化、切换会话/刷新恢复、Markdown/图片附件基础路径，以及错误可观测性。

## 范围

本轮优先使用 `mock` runtime 做确定性测试，避免外部 Claude/Codex 登录、额度、网络和模型行为影响判断。Claude/Codex 只验证平台能力入口是否存在，不在本轮要求真实模型输出。

## 测试步骤

1. 启动独立测试环境
   - 使用独立 `DATA_DIR`，避免污染现有数据。
   - 后端端口：18800。
   - 前端端口：5173。
   - 验证 `/health`、前端页面和 WS 连接。

2. WS 级主链路测试
   - 创建项目。
   - 创建/使用 mock Agent。
   - 创建 session。
   - 发送 prompt。
   - 订阅并收集 `session:event`、`session:update`、`session:done`。
   - 验证：
     - user message 已持久化。
     - agent message 完成后已持久化。
     - events 可重放。
     - 切换/重连后可读取 messages/events。

3. UI 级主链路测试
   - 打开前端。
   - 创建项目。
   - 在 Agent 广场部署/创建 mock Agent。
   - Workspace 新建会话。
   - 发送消息并等待流式完成。
   - 验证完成后消息不消失。
   - 刷新页面后重新选择会话，验证历史可见。

4. 附加路径
   - 发送 Markdown 内容，确认回复区域 Markdown 渲染不崩。
   - 上传图片附件，确认用户消息保留附件且后端不报错。
   - 测试滚动到底部是否跟随最新输出。

## 验收标准

- `npm run build` 通过。
- `npm run lint` 通过。
- `npm test` 通过。
- WS 级测试能证明 messages/events 持久化。
- UI 级测试能证明发送、流式、完成、刷新/切换恢复可用。
- 如发现缺陷，必须先定位根因，再用最小改动修复，并补自动化回归测试。

## 非目标

- 不在本轮修工具管理页、Schedule、多项目规则隔离、Skill 注入等非对话主链路问题。
- 不强依赖真实 Claude/Codex 输出。
