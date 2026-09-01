# 阅读 URL 支持 HTTP/HTTPS

## 目标

让 `reading.add` 的 `url` 类型接受 `http://` 和 `https://`，继续拒绝其他协议。

## 步骤

1. 修改 `reading.add` handler 的 URL 协议校验与错误描述。
2. 增加 HTTP、HTTPS、非 HTTP(S) 协议回归测试。
3. 运行定向测试、全量测试、lint、build 和 diff 检查。
4. 提交独立 commit，交由主仓库合并到 `prd`。

## 边界

- 不修改数据库结构、URL 读取/代理逻辑或前端。
- 不允许 `file:`, `javascript:`, `data:` 等协议。
- 不重启 PRD 服务。
