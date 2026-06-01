# Team 会话 UI 审查与 Web 烟测

## 目标

确认 Team 会话侧栏在真实 Web 页面中可用，并修复审查中发现的阻塞问题。

## 步骤

1. 代码审查 Team 会话上下文链路。
   - 验收：列出 Critical/Important/Minor，Critical 必须修复。
2. 修复审查中发现的阻塞问题。
   - 验收：新增或补充测试覆盖修复点。
3. 运行自动化验证。
   - 验收：`npm test`、`npm run build`、`npm run lint`、`git diff --check` 通过。
4. 启动临时本地服务并准备烟测数据。
   - 验收：后端与前端端口可访问，临时库包含 Team leader/member/session/task/mailbox 数据。
5. 浏览器验证 Workspace 主链路。
   - 验收：Leader/Worker 会话可切换，Team 侧栏展示正确，普通会话不残留 Team 上下文。
