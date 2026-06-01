# PRD Worktree Local Runtime Plan

目标：创建独立 `prd` worktree，作为本机正式使用实例。正式实例与开发实例隔离端口、数据库和日志，并内置可部署的正式 Team Leader 模板。

## 步骤

1. 从当前 `master` 提交创建 `prd` 分支 worktree 到 `../ai-ide-studio-prd`。
   - 验证：`git worktree list` 能看到 `prd` worktree。
2. 在 `prd` worktree 中增加正式本地启动脚本和说明。
   - 端口：18800
   - 数据库：`data-prd/ai-ide.sqlite`
   - 日志：`data-prd/logs`
   - 验证：脚本不依赖开发实例端口和数据库。
3. 增加正式 Team Leader 内置模板 seed。
   - 模板名称：正式 Team Leader
   - runtime：claude
   - type：leader
   - 能力：创建 Team、招募真实成员、派活、读取 mailbox、总结闭环。
   - 验证：测试覆盖模板存在、可部署并可绑定 team-leader 工具权限。
4. 构建并运行基础校验。
   - `npm test`
   - `npm run build`
   - `npm run lint`
   - `git diff --check`
5. 输出正式使用路径、启动命令和访问地址。
