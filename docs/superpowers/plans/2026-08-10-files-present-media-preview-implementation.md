# files.present 多媒体与绝对路径预览实施清单

## 目标

扩展 `files.present` 的 PC 与 APP 预览能力，使图片、音频、视频、Markdown 正文和 Markdown 内资源均可查看；保留服务器任意绝对路径支持，并通过短期签名资源地址与 HTTP Range 提供安全、可靠的媒体加载。

## 实施步骤

- [x] 后端扩展 `FileKind`、媒体 MIME、可分段文件流与绝对路径规范化。
- [x] 新增短期资源签名服务及已鉴权的签名地址 RPC，签名绑定资源来源、项目、规范化路径和过期时间。
- [x] 扩展 `/api/fs/asset`，验证短期签名并支持 `200/206/416`、`Accept-Ranges`、`Content-Range`。
- [x] PC 新增统一资源地址解析和文件内容路由，支持图片、音频、视频与下载兜底。
- [x] PC Markdown 自定义资源渲染，支持项目相对路径、服务器绝对路径、`file://` 和 HTTPS。
- [x] APP 显式传递 `projectId`，移除文件预览对全局文件树项目状态的依赖。
- [x] APP 新增图片、音频、视频视图并支持多文件切换时停止旧媒体。
- [x] APP Markdown 使用同一资源解析规则展示内嵌图片。
- [x] 补齐后端、PC、APP 单元与集成测试，覆盖绝对路径、签名过期/篡改、Range 和 Markdown 图片。
- [x] 更新架构与使用文档，运行 `npm test`、`npm run lint`、`npm run build`、`git diff --check`。
- [ ] 完成代码审查、提交并合并到 `prd`，不启动或重启任何服务。

## 路径规则

- 项目相对路径按项目工作目录解析，禁止目录逃逸。
- Windows 盘符、UNC 和 `file:///` 地址按服务器绝对路径解析，可位于项目外。
- Linux 绝对路径使用 `file:///var/...` 消除与项目根路径 `/assets/...` 的歧义。
- HTTPS 外部资源直接加载且不携带平台 token；明文 HTTP 仅按客户端能力尽力支持。
- `javascript:` 等可执行协议拒绝加载。

## 验收标准

- PC 与 APP 能从同一张卡片切换预览 Markdown、图片、音频、视频。
- Markdown 中的相对图片、服务器绝对路径图片和 HTTPS 图片可显示。
- 大媒体文件不进入 WS 消息正文，播放器通过 Range 请求加载和拖动。
- 临时地址过期后重新打开可自动获取新地址，不影响历史预览。
- APP 不因全局文件树项目状态为空或变化而加载错误项目资源。
- 历史 presentation 数据无需迁移并继续兼容。
