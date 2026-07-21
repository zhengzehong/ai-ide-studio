# 测试指南

## 测试框架

项目使用 **Vitest** 作为测试框架，配置文件为 `vitest.config.ts`。

## 目录结构

```
tests/
├── unit/                # 纯函数测试（不依赖 DB/网络）
│   ├── capability-merge.test.ts
│   ├── capability-state-merge.test.ts
│   ├── session-event-reducer.test.ts
│   └── session-finalize.test.ts
└── integration/         # 集成测试（使用临时 SQLite）
    ├── sqlite-migration.test.ts
    ├── session-events.test.ts
    ├── ws-capabilities.test.ts
    ├── ws-fork.test.ts
    └── task-session-lifecycle.test.ts
```

## 运行命令

```bash
npm test                    # 运行所有测试
npm run test:unit           # 仅单元测试
npm run test:integration    # 仅集成测试
npm run test:watch          # 监听模式（文件变更自动重跑）
```

## 编写测试

### 单元测试

适用于纯函数、状态计算、数据变换等不依赖外部资源的逻辑。

```typescript
import { describe, test, expect } from 'vitest'
import { myFunction } from '../../ui/src/stores/session-events.ts'

describe('myFunction', () => {
  test('描述测试行为', () => {
    const result = myFunction(input)
    expect(result).toBe(expected)
  })
})
```

### 集成测试

需要 DB 的测试使用临时目录，在 `beforeAll`/`afterAll` 中初始化和清理：

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initDatabase, closeDatabase } from '../../src/store/db.js'

const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-test-'))
beforeAll(() => initDatabase(resolve(tmp, 'test.sqlite')))
afterAll(() => { closeDatabase(); rmSync(tmp, { recursive: true, force: true }) })

describe('功能描述', () => {
  test('测试场景', () => {
    // ...
  })
})
```

## 测试规范

1. **新功能必须有测试** — 提交前确保 `npm test` 通过
2. **修 bug 先写复现测试** — 确保修复后不会回归
3. **测试文件命名** — `xxx.test.ts`，和被测模块对应
4. **测试描述用中文** — 保持和项目 UI 一致
5. **集成测试用临时目录** — 避免污染开发数据

## 性能与故障门禁

```bash
npm run check:ui-bundle       # PC 主入口预算和动态页面数量
npm run perf:phase5:smoke     # 30 Session / 5 秒 Runtime-Realtime smoke
npm run perf:browser          # Chrome 生产构建刷新与缓存路由切换

# 默认 30 Session / 30 分钟；可覆盖 sessions、duration-ms、sample-ms
npx tsx scripts/performance/phase-5-soak.ts --json
```

`phase-5-performance.test.ts` 验证 Session History p95 与 2 秒慢 Query 下的 Realtime p95/p99；`phase-5-process-failures.test.ts` 注入 Query Worker、Writer Worker、Realtime 和 Runtime 退出。soak runner 校验每轮每 Session 恰好一个 done、无超时、Runtime 首帧延迟和长时间 heap 趋势。浏览器 runner 使用系统 Chrome、生产静态资源和 IndexedDB stale snapshot，预算为 warm hard refresh p95 `<300ms`、缓存项目/页面切换 p95 `<50ms>`。

浏览器 runner 默认使用 `C:\Program Files\Google\Chrome\Application\chrome.exe`；其他安装位置通过 `PLAYWRIGHT_CHROME_PATH` 指定。运行前先执行 `npm run build`。

## Runtime 取消回归

取消相关改动至少覆盖以下测试边界：

- `sdk-runtime-host-lifecycle.test.ts`：soft cancel、目标 Session close、Agent restart、迟到输出 fencing 和单一 terminal done。
- `runtime-process.test.ts`：process IPC 的结构化取消结果与原 turn identity。
- `session-command-service.test.ts`：API 不伪造 done、不提前清 active prompt，Runtime `not-found` 明确失败。
- `session-store-prompt-acceptance.test.ts` / `global-assistant-store.test.ts`：重复点击去重、失败恢复和替代 Prompt 等待取消。
- `global-assistant-input.test.ts`：stopping 期间输入框可编辑、停止按钮不可重复点击、错误可见。

人工验证必须使用独立端口和独立 `DATA_DIR`，不得复用正在运行的 PRD 端口或数据库。验证 Claude/Codex 长工具调用时，检查点击停止后立即出现“正在停止”，随后能发送下一条消息，并确认日志中只有原 turn identity 的一个 `cancelled` done。
