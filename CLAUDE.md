# CLAUDE.md

AI IDE Studio —— 构建在 Claude Code / Codex 之上的协作平台(网关 + Edge + 数据层 + 移动端/桌面端)。

## 工程规约

### AppConfig 与 Edge 协议白名单必须同步

给 `src/core/config.ts` 的 `AppConfig` 新增/删除/重命名字段时,必须同步 `src/edge/protocol.ts` 两处:

1. `APP_CONFIG_KEY_LIST` —— Edge 握手 `start` 消息的 key 白名单
2. `optionalStrings` / `optionalBooleans` / `optionalNumbers` 的分型列表

**原因**:白名单是接口的手工字符串副本,漏同步时 TypeScript 不报错,但默认 `edgeMode='process'` 下 Edge 子进程会**静默拒收** `start` 消息(`api-entry.ts` 校验失败无任何日志),父进程 60 秒后 readiness timeout,工程启动失败且报错完全不指向根因。已两次中招:`dataBatchCommitRetentionMs`、`modelCaptureProxyPort`。

**兜底(均已就位)**:

- `APP_CONFIG_KEY_LIST` 的编译期覆盖断言(`MissingAppConfigKeys`)——漏同步字段直接 tsc 报错并列出缺失键名;
- `tests/unit/edge-protocol.test.ts` 的回归测试——真实 `loadConfig()` 输出过 `isParentToApiMessage`,分型列表写错类型会导致 CI 红。
