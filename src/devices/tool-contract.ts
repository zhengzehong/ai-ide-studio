export const DEVICE_LIST_DESCRIPTION = '列出用户已授权的 Windows 桌面执行设备，含机器名、系统、Shell、在线状态和 isCurrentDevice（本轮用户消息来源电脑）。普通命令和文件工具仍在服务器执行。用户说“这台电脑”时仅在 isCurrentDevice 唯一明确时使用该 deviceId；无标识则先确认，不猜测。手机和浏览器不注册执行设备。'
export const DEVICE_INVOKE_DESCRIPTION = '显式操作已授权的远程 PC，每次必填 deviceId，不改变普通工具的服务器执行位置，离线不回退。shell 执行命令（最长等待 5 秒，未结束返回 jobId）；job.status 查询同会话作业和分页日志；job.cancel 请求取消并等待节点确认。file.upload 将 PC 文件传到服务器供 AI 读取；file.download 将服务器项目文件或 fileId 下载到 PC。文件异步传输，请用 job.status 查询。'
export const DEVICE_INVOKE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    deviceId: { type: 'string', description: 'device_list 返回的明确设备 ID，不允许省略或猜测' },
    type: { type: 'string', enum: ['shell', 'job.status', 'job.cancel', 'file.upload', 'file.download'] },
    command: { type: 'string', description: 'shell 命令，仅在指定 PC 执行' },
    cwd: { type: 'string', description: 'PC 上的绝对工作目录；未指定使用该 PC 用户目录' },
    shell: { type: 'string', enum: ['powershell', 'pwsh'], description: '使用设备声明的 Shell，默认优先 pwsh' },
    outputEncoding: { type: 'string', enum: ['utf8', 'gb18030'], description: 'Shell 控制台编码，默认 UTF-8；旧中文程序可显式选 gb18030，不自动猜测文件编码' },
    timeoutSeconds: { type: 'integer', description: 'shell 执行超时，默认 60，范围 1 至 600 秒' },
    background: { type: 'boolean', description: '节点接受后即返回作业 ID' },
    jobId: { type: 'string', description: '查询或取消的作业 ID，必须属于指定设备和当前会话' },
    cursor: { type: 'integer', description: '分页日志偏移，使用上次 nextCursor，默认 0' },
    localPath: { type: 'string', description: '上传源或下载目的文件的 PC 绝对路径' },
    serverPath: { type: 'string', description: '下载源文件，服务器当前项目目录内路径；与 fileId 二选一' },
    fileId: { type: 'string', description: '先前上传得到的文件 ID，当前会话范围内；与 serverPath 二选一' },
    overwrite: { type: 'boolean', description: '下载是否覆盖已有 PC 文件，默认 false' },
  }, required: ['deviceId', 'type'],
}
