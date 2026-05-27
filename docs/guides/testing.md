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
