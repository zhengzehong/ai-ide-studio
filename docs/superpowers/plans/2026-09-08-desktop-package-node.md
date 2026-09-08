# 桌面包缺失模块修复

- [x] 两份 Electron Builder 配置补齐 node 目录，启用安装向导和目录选择。
- [x] 先补缺失打包依赖回归测试，新增编译产物/实际发布内容校验。
- [x] 编译后、发布替换旧产物前执行校验，失败不覆盖旧发布包。
- [x] 运行测试、lint、build；隔离配置实际启动打包 EXE 并检查窗口与预加载。
- [x] 自查修复内容，准备提交发布；不重启 PRD。

## 验证记录

- 全量 421 文件 / 2249 测试通过；打包相关 2 文件 / 12 测试通过；lint、生产构建与 Electron 编译通过。
- 编译模块和实际发布模块字节对账，嵌套 import/export/动态 import/require 检查，独立 preload 检查，后端重定位检查。
- worktree 依赖目录 junction 导致打包器漏收传递依赖，改用真实独立依赖目录，并增加包内生产依赖闭包检查，防止借用开发机父目录依赖。
- 使用 Playwright 启动 win-unpacked 中真实 EXE，断言 app.isPackaged、隔离 userData、首次设置窗口、preload 与远程表单，保存截图。
- 实际启动安装器，通过 Windows UI Automation 验证安装选项及目录选择页；未点击安装，不覆盖现有客户端。
- 便携启动器未完成 Playwright 调试连接验收；其共用应用内容经 win-unpacked 实际启动验证，不声称已完整跑过便携自解压链路。
