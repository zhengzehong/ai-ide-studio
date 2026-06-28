# PRD 内置模板重复修复计划

## 目标

修复 PRD 本地实例反复启动后 Agent 广场内置模板重复的问题，并确认 18900 端口上的服务状态可解释、可重启。

## 已确认现象

- `start-prd-local.ps1` 默认使用 `18900`。
- `18900` 被已有 `node dist/entry.js` 进程占用时，脚本会拒绝二次启动。
- 内置模板中只有 `tpl-team-leader` 使用固定 ID，其他内置模板仍使用随机 ID，导致 seed 逻辑每次重启都会重新插入。

## 步骤

1. 查询 18900 监听进程和 PRD 数据库重复模板。
2. 给所有内置模板补稳定 ID，并让 seed 按固定 ID / 内置自然键幂等跳过。
3. 清理当前 `data-prd/ai-ide.sqlite` 中已有重复内置模板。
4. 重启 PRD 实例，确认 `/health` 和 `/workspace` 可访问，模板不再重复增长。
5. 运行 `npm test`、`npm run build`、`npm run lint`、`git diff --check`。

## 验收标准

- 重复模板清理后，同一内置模板只保留一条。
- 重启后内置模板数量不增加。
- PRD 地址为 `http://127.0.0.1:18900/workspace`，不再占用开发默认端口 `18800`。
- 基础测试、构建、lint 和 diff 检查通过。
