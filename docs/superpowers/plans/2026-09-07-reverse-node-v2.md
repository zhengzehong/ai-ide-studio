# 客户端远程执行 v2 实施清单

日期：2026-09-07。
任务：task-1a198c52 / step-e4d3d33d；前期分析 task-6786a40f。
方案：`docs/design/reverse-node-v2.md`。
开发分支：feat/remote-device-execution，基线 31b8664。
授权边界：隔离开发和测试，不部署、不重启 PRD、不操作在线 DB。

## R1 设备发现与来源

- [x] 独立 worktree，保留主仓库所有无关改动。
- [x] 新增 src/devices 鉴权、连接、网关模块，以及 devices/device_pairings/device_jobs 三表（迁移 063）；sessions 不增加默认目标。
- [x] 配对码限流、一次消费；独立哈希设备凭证；Electron safeStorage 按服务器 origin 隔离。
- [x] 仅 Windows remote 客户端 opt-in 注册；本地托管模式不探测 Shell；手机/浏览器不注册。
- [x] 主进程签名绑定 session/message/时效，服务器校验后随排队批次生效，结束清除；混合来源不猜测。
- [x] API/Edge 明确路由 node-ws；generation 防旧连接摘除新连接；心跳与退避重连。
- [x] 设置页启停/解绑/刷新及四状态；IPC 校验主窗口主帧，首次授权使用原生确认。

## R2 作业与工具

- [x] 全局注册 device_list/invoke_device_command，覆盖 handler、seed、可见性和独立 stdio 桥接。
- [x] 默认普通工具仍在服务器；每次远程调用显式 deviceId；作业查询取消验证设备和会话归属；访客禁止。
- [x] 服务端先持久化再发送，节点先登记再执行，重连仅对账，unknown 不自动重放。
- [x] welcome/job.submit/job.state/job.log/job.query/job.cancel + 协议版本/generation；running 是节点接受确认。
- [x] 工具等待最多 5 秒，执行寿命独立；分页日志 10 MiB 上限，截断不杀命令。
- [x] PowerShell 临时脚本避免 Windows 命令行上限；UTF-8/GB18030；真实 cwd、超时、进程树取消。
- [x] 客户端无法确认进程树停止时保留执行名额；服务器历史 unknown 不妨碍提交新诊断，由节点控制实际并发。

## R3 文件传输

- [x] 专用流式模块与作业票据，owner 密钥不作为设备任意服务器文件访问凭证。
- [x] 单文件上传后台完成，返回 fileId/serverPath/size/hash/expiresAt。
- [x] 下载当前项目内真实路径或当前会话 fileId，快照、哈希、临时落地及默认拒绝覆盖。
- [x] 默认单文件 1 GiB、总预约 5 GiB、30 分钟总寿命、60 秒无进展限制；上传结果保留 7 天。
- [x] 临时文件失败清理、运行期重试和重启孤儿快照清理。
- [x] 票据绑定设备/作业/方向，5 分钟内发起且单次使用；过期或失败须新建传输，不续签、不续传。

## R4 验证与提交

- [x] 单元与集成覆盖来源签名/混合来源/访客、设备归属、连接代次、重启去重、并发、日志分页。
- [x] 真实 Windows PowerShell 执行、23K 长脚本、中文双编码、超时及父子进程树取消。
- [x] 隔离 Edge/API/节点链路，真实文件双向传输与 hash 一致、默认覆盖拒绝。
- [x] 票据设备绑定/方向/复用/过期，超限/hash 错误，容量预约测试。
- [x] Playwright 设置组件 desktop/narrow、启停、四状态、无溢出检查；仅设备 API/bridge mock。
- [x] README、架构总览/数据模型/WS 协议、使用指南更新。
- [ ] 最终 npm test/lint/build、UI/Electron 类型检查、git diff --check 复跑。
- [ ] 完成逐文件自查、提交 worktree 分支并汇报；不自行合并 PRD。

## 首版实现取舍

- 自动 owner 配对，不增加手工输入配对码的界面。
- 上传用独立流式存储，不修改普通聊天附件 50 MiB 的行为。
- 文件路径以项目根目录为边界，不以任意 Agent 子目录作为共享授权根。
- 不支持无共享文件系统的跨机 runtime；结果只证明 Gateway 文件已落地。
- 仅 PowerShell/pwsh；无 Windows Job Object，强杀客户端或断电不能保证清理子进程。
- 单作业日志有上限，作业去重收据不自动删除；总历史日志保留策略另行设计，不宣称已全局限额。

## 发布前待验收（不冒充已测）

- [ ] 新 Electron 安装包在第二台真实 PC 的配对、切服务器、启停与退出。
- [ ] 实际聊天“这台电脑”来源证明与网络断开恢复；手机真实入口远程排查。
- [ ] 真实工具 runtime 端到端 5 秒等待、读取上传文件；当前测试覆盖服务和工具桥接，非完整模型调用。
- [ ] pwsh 实机（如安装）、真实 1 GiB 文件与 5 GiB 配额、磁盘不足和传输中断故障注入。
- [ ] 独立审查与用户授权部署；合并及迁移在线实例另行操作。
