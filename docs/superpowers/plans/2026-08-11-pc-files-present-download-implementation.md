# PC files.present 下载实施计划

## 目标

为 PC 端 files.present 的 Markdown、文本、图片、音频、视频和二进制文件提供统一下载入口。复用现有 `fs.assetUrl(mode=attachment)` 短期签名地址，不增加后端资源接口。

## 实施范围

- 新增前端下载服务：Electron 通过受限 IPC 选择本地保存路径，普通浏览器使用原生下载降级。
- 在全屏文件预览和普通文件预览头部提供下载按钮，媒体预览继续支持下载。
- Electron 主进程校验同源 `/api/fs/asset`、attachment 模式和签名参数，处理取消、完成、失败和超时。
- 增加 URL 策略单测和 PC 预览下载入口回归断言。

## 验收

- 所有 files.present 文件类型都有下载入口。
- Electron managed-local 与 remote 模式都能选择本机保存位置。
- 外部 URL、非 attachment URL 和无签名 URL 被拒绝。
- 不把长期访问 token 放入下载 URL。
