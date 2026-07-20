# 本机正式实例使用说明

本目录是 `prd` worktree，用于正式使用 AI IDE Studio。不要在这里做功能开发。

## 配置

- 分支：`prd`
- 访问地址：`http://127.0.0.1:18900/workspace`
- 后端端口：`18900`
- 数据库：`data-prd/ai-ide.sqlite`
- 日志：`data-prd/logs`

`data-prd/` 已加入 `.gitignore`，不会提交到仓库。

## 首次启动

```powershell
# 如需临时换端口，可先设置：$env:AI_IDE_PRD_PORT="18901"
npm install
npm run build
.\scripts\start-prd-local.ps1
```

## 正式 Leader Agent

Agent 广场内置模板包含：`正式 Team Leader`。

使用方式：

1. 打开 `http://127.0.0.1:18900/workspace`。
2. 左上角创建或选择项目。
3. 进入 `Agent 广场`。
4. 找到 `正式 Team Leader`，点击 `添加到项目`。
5. 回到工作台，在该 Agent 下新建会话。

该模板部署到项目后会自动绑定 `team-leader` 工具权限，可创建 Team、招募成员、派发任务、读取 mailbox 并做闭环总结。

## 与开发实例隔离

开发实例建议继续使用原仓库：

- 目录：`D:\code_space\python_space\ai-ide-studio`
- 后端端口：`18888`
- 前端端口：`5173`
- 数据库：`data-dev/ai-ide.sqlite`
