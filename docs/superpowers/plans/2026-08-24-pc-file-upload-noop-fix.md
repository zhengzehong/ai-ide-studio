# PC 远程模式文件上传无响应修复

## 目标

修复桌面客户端通过普通 HTTP 远程服务器访问 Workspace 时，PDF、TXT 等普通文件选择和拖拽无响应的问题，同时保持图片附件行为不变。

## 改动

1. 复现并确认非安全上下文缺少 `crypto.randomUUID()`。
2. 增加兼容 HTTP 环境的本地附件 ID 生成函数。
3. Workspace 普通文件上传改用兼容函数，并补充回归测试。

## 验收

- HTTP 远程地址下，PDF/TXT 选择与拖拽均发起 `POST /api/v1/session-files`。
- HTTPS 和 localhost 下仍优先使用原生 `crypto.randomUUID()`。
- 既有图片附件和 Prompt 路径注入行为不变。
- 通过定向测试、lint、build。
