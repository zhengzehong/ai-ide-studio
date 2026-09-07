# 远程电脑

## 启用

服务器和 Windows 桌面客户端均需包含远程设备功能的新版本。桌面客户端以 remote 模式连接服务器后，在“设置 → 远程电脑”打开“允许远程访问”，并在本机系统对话框确认授权。

授权只开启显式设备工具，不改变普通 AI 工具的服务器执行位置。设备凭证与原服务器访问密钥分开保存，并使用 Electron safeStorage 加密。切换服务器后不复用原设备凭证。HTTP 内网连接保持可用，公网应使用 HTTPS。

手机、浏览器和 managed-local 桌面不注册执行节点。手机发来的请求仍可让服务器上的 AI 操作已授权 PC，但没有“当前电脑”标记。

## 两项工具

`device_list` 无参数，返回已授权 PC、机器名、系统版本、可用 Shell、常用目录、在线状态和 `isCurrentDevice`。

“这台电脑”的识别来自本轮用户消息的签名证明。多来源消息合批、手机、浏览器和自动消息均不会猜测来源设备；没有唯一标识时应让用户明确设备。它不是默认执行目标。

`invoke_device_command` 的每次调用均须包含 `deviceId` 和 `type`：

| 操作 | 参数 |
|---|---|
| `shell` | `command`；可选 `cwd/shell/outputEncoding/timeoutSeconds/background` |
| `job.status` | `jobId`；可选 `cursor` |
| `job.cancel` | `jobId` |
| `file.upload` | PC 的 `localPath` |
| `file.download` | `localPath`，`serverPath/fileId` 二选一；可选 `overwrite` |

Shell 默认优先 pwsh，其次 Windows PowerShell 5.1；以当前 Windows 用户权限运行，不自动提权。控制台默认 UTF-8，可显式选择 `gb18030`，不会按输出块自动猜测编码；文件本身编码不受此选项修改。

命令默认超时 60 秒，最大 600 秒；工具等待最多 5 秒，后台请求在节点接受后返回。若返回 `queued/running`，用 `job.status` 查询；用 `nextCursor` 读取下一页日志。每作业日志上限 10 MiB，截断日志不会杀死命令。

上传始终异步，完成后返回 `fileId/serverPath/size/sha256/expiresAt`；服务器 AI 可直接读取 `serverPath`。下载只接受当前项目目录内源文件或当前会话的上传 fileId，校验成功后才安装到目标路径，默认拒绝覆盖已有文件。

## 边界与故障

- 每台节点最多同时执行 2 个命令、1 个文件传输，忙时明确拒绝。
- 设备离线不会换机或回退到服务器。断线或重启后只核对已有作业，不重跑可能有副作用的命令。
- 取消先返回 `cancel_requested`，只有客户端确认才是 `cancelled`；无法确认进程树结束时报告 `unknown`，客户端仍保留执行名额，防止持续新建可能残留的进程。此时需在该 PC 核查残留进程后恢复节点。强制杀死桌面程序或断电不保证作业存活，也不保证能清理进程树。
- 单文件默认 1 GiB，总临时配额默认 5 GiB；可配置 `DEVICE_FILE_MAX_BYTES`、`DEVICE_FILE_QUOTA_BYTES`。上传文件保留 7 天；传输总时限 30 分钟、60 秒无进展终止，不支持断点续传。普通聊天附件仍保持原 50 MiB 上限。
- 传输准备前保守预约一个单文件上限。文件传输失败后提交新作业，不重复使用旧票据。
- 文件读取假定 Gateway 与 AI runtime 共享文件系统；独立远端 runtime 不在此能力覆盖范围。
- 本机关闭访问会请求停止受管作业；服务端可停用或解除配对。撤销设备需重新配对，不自动恢复授权。

## 验证

`tests/integration/device-execution.test.ts` 使用隔离数据库、随机端口和真实 Edge/API/节点协议，Windows 上实际执行 PowerShell 与双向文件传输。`scripts/repro/device-settings-browser.mjs` 检查设置组件的启停及 loading/error/empty/data 状态，截图写入工作树 `data/device-review/`，结束后自动关闭测试服务器。

发布前仍应以新版桌面包在真实第二台 PC 验证配对、实际“这台电脑”识别和网络断开恢复。开发测试不等同于已部署 PRD。
