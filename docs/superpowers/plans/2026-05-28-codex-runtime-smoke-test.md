# Codex runtime 重启后烟测

## 目标
- 重启后端和前端服务。
- 验证 Codex runtime 是否使用系统 Codex。
- 通过 WS 创建 Codex 会话并发送一条最小消息。
- 记录服务地址和测试结果。

## 步骤
1. 停止旧 node/tsx/vite/ACP 进程 -> 验证端口释放。
2. 启动后端与 UI -> 验证 health / 页面地址。
3. WS 查询 agent，创建 Codex 会话，发送测试 prompt -> 验证不再出现 service_tier 报错。
4. 汇总结果。
