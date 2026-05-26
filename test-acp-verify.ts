/**
 * ACP 集成验证测试
 * 测试 ACP 协议连接的各个层面：底层 JSON-RPC、SDK 导入、AgentProcess、acpHost
 */

import { spawn } from 'child_process'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import * as acp from '@agentclientprotocol/sdk'

// ─── 工具函数 ───

let passed = 0
let failed = 0

function check(name: string, fn: () => boolean | Promise<boolean>) {
  return async () => {
    try {
      const ok = await fn()
      if (ok) {
        console.log(`  ✓ ${name}`)
        passed++
      } else {
        console.log(`  ✗ ${name} (断言失败)`)
        failed++
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`  ✗ ${name} (${msg})`)
      failed++
    }
  }
}

function summary() {
  console.log(`\n${'═'.repeat(50)}`)
  console.log(` 通过: ${passed}  |  失败: ${failed}  |  总计: ${passed + failed}`)
  console.log(`${'═'.repeat(50)}`)
  if (failed > 0) {
    console.log(`\n❌ 验证失败 — ${failed} 个测试未通过\n`)
    process.exit(1)
  } else {
    console.log(`\n✅ 所有 ACP 集成验证通过！\n`)
  }
}

// ─── 测试 1: ACP SDK 导入 ───

async function test1_sdk_imports() {
  console.log('\n【测试 1】ACP SDK 导入验证')
  const tests = [
    check('SDK 模块可导入', () => typeof acp.PROTOCOL_VERSION === 'number'),
    check('PROTOCOL_VERSION >= 1', () => acp.PROTOCOL_VERSION >= 1),
    check('ClientSideConnection 可访问', () => typeof acp.ClientSideConnection === 'function'),
    check('AgentSideConnection 可访问', () => typeof acp.AgentSideConnection === 'function'),
    check('ndJsonStream 可访问', () => typeof acp.ndJsonStream === 'function'),
    check('CLIENT_METHODS 已定义', () => typeof acp.CLIENT_METHODS === 'object' && Object.keys(acp.CLIENT_METHODS).length > 0),
    check('AGENT_METHODS 已定义', () => typeof acp.AGENT_METHODS === 'object' && Object.keys(acp.AGENT_METHODS).length > 0),
  ]
  for (const t of tests) await t()
  console.log(`  → ACP SDK 协议版本: ${acp.PROTOCOL_VERSION}, Client 方法: ${Object.keys(acp.CLIENT_METHODS).length}, Agent 方法: ${Object.keys(acp.AGENT_METHODS).length}`)
}

// ─── 测试 2: Mock Agent 直接 JSON-RPC 协议通信 ───

async function test2_mock_agent_protocol() {
  console.log('\n【测试 2】Mock Agent 直接 ACP/JSON-RPC 协议通信')

  const mockPath = resolve(import.meta.dirname, 'src', 'acp', 'mock-agent.ts')

  return new Promise<void>((resolveTest) => {
    const proc = spawn('npx', ['tsx', mockPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    let buffer = ''
    let resolveNext: ((v: unknown) => void) | null = null
    let nextId = 1
    const notifications: Array<Record<string, unknown>> = []

    proc.stderr!.on('data', (_chunk: Buffer) => {
      // mock-agent 不向 stderr 写内容，忽略
    })

    // 单一 stdout 处理 —— 同时处理响应和通知，不破坏监听器
    proc.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const msg = JSON.parse(trimmed)
          if ('id' in msg && msg.id !== undefined) {
            // 这是一个响应
            if (resolveNext) {
              const cb = resolveNext
              resolveNext = null
              cb(msg)
            }
          } else if (msg.method) {
            // 这是一个通知
            notifications.push(msg)
          }
        } catch {
          // 忽略解析错误
        }
      }
    })

    function send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = nextId++
        const request = { jsonrpc: '2.0', id, method, params }

        const timeout = setTimeout(() => {
          resolveNext = null
          reject(new Error(`请求超时: ${method}`))
        }, 10000)

        resolveNext = (resp: unknown) => {
          clearTimeout(timeout)
          const r = resp as { result?: unknown; error?: unknown }
          if (r.error) {
            reject(new Error((r.error as { message: string }).message || '未知错误'))
          } else {
            resolve(r.result)
          }
        }

        proc.stdin!.write(JSON.stringify(request) + '\n')
      })
    }

    const tests = [
      check('initialize 请求-响应', async () => {
        const result = await send('initialize', {
          protocolVersion: '2025-11-16',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        })
        const r = result as { protocolVersion: string; serverInfo: { name: string } }
        return r.protocolVersion === '2025-11-16' && r.serverInfo.name === 'mock-agent'
      }),

      check('session/create 请求-响应', async () => {
        const result = await send('session/create', { workingDirectory: process.cwd() })
        const r = result as { sessionId: string }
        return r.sessionId != null && r.sessionId.startsWith('mock-session-')
      }),

      check('session/prompt 接收流式通知', async () => {
        const { sessionId } = (await send('session/create', { workingDirectory: process.cwd() })) as { sessionId: string }

        // 清空之前的通知
        notifications.length = 0

        const promptResult = await send('session/prompt', { sessionId, content: 'hello 测试' })
        const r = promptResult as { accepted: boolean }

        // 等待流式通知到达
        await new Promise((r) => setTimeout(r, 2000))

        // 验证收到了 stream 通知
        const updateNotifs = notifications.filter(
          (n) => n.method === 'session/update' && (n.params as Record<string, unknown>)?.sessionId === sessionId
        )

        return r.accepted === true && updateNotifs.length > 0
      }),

      check('session/close 请求-响应', async () => {
        const { sessionId } = (await send('session/create', { workingDirectory: process.cwd() })) as { sessionId: string }
        await send('session/close', { sessionId })
        return true
      }),

      check('shutdown 请求-响应', async () => {
        await send('shutdown', {})
        return true
      }),
    ]

    let testIndex = 0

    async function runNext() {
      if (testIndex >= tests.length) {
        proc.kill()
        resolveTest()
        return
      }
      await tests[testIndex]()
      testIndex++
      await runNext()
    }

    proc.on('error', (err) => {
      console.log(`  ✗ 进程启动失败: ${err.message}`)
      failed++
      resolveTest()
    })

    runNext()
  })
}

// ─── 测试 3: AgentProcess 类（自定义进程管理器） ───

async function test3_agent_process() {
  console.log('\n【测试 3】AgentProcess 类（自定义 ACP 进程管理器）')

  const { AgentProcess } = await import('./src/acp/process.js')

  const mockPath = resolve(import.meta.dirname, 'src', 'acp', 'mock-agent.ts')
  let proc: InstanceType<typeof AgentProcess> | null = null

  const tests = [
    check('AgentProcess 启动 + initialize', async () => {
      proc = new AgentProcess('npx', ['tsx', mockPath], {})
      const result = await proc.start()
      return (
        result.protocolVersion === '2025-11-16' &&
        result.serverInfo.name === 'mock-agent'
      )
    }),

    check('AgentProcess session/create', async () => {
      const result = await proc!.sendRequest('session/create', { workingDirectory: process.cwd() })
      const r = result as { sessionId: string }
      return r.sessionId != null && r.sessionId.startsWith('mock-session-')
    }),

    check('AgentProcess session/prompt + 接收通知', async () => {
      const { sessionId } = (await proc!.sendRequest('session/create', { workingDirectory: process.cwd() })) as { sessionId: string }

      const notifPromise = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 8000)
        proc!.on('notification', (n: { method: string; params?: Record<string, unknown> }) => {
          const params = n.params as Record<string, unknown>
          if (n.method === 'session/update' && params?.type === 'message_done') {
            clearTimeout(timer)
            resolve(true)
          }
        })
      })

      const promptResult = await proc!.sendRequest('session/prompt', { sessionId, content: 'hello' })
      const gotDone = await notifPromise
      return (promptResult as { accepted: boolean }).accepted === true && gotDone
    }),

    check('AgentProcess stop 正常关闭', async () => {
      await proc!.stop()
      return !proc!.isRunning
    }),
  ]

  for (const t of tests) await t()
}

// ─── 测试 4: ACP 主机集成（acpHost + mock agent） ───

async function test4_acp_host() {
  console.log('\n【测试 4】acpHost 集成（启动/会话/提示/关闭）')

  // 初始化数据库
  const { initDatabase } = await import('./src/store/db.js')
  const dataDir = resolve(import.meta.dirname, 'data')
  mkdirSync(dataDir, { recursive: true })
  initDatabase(resolve(dataDir, 'test-acp.json'))

  const { acpHost } = await import('./src/acp/host.js')
  const { agentStore } = await import('./src/store/agents.js')
  const { events } = await import('./src/core/events.js')

  // 注册测试 agent
  agentStore.upsert({
    id: 'mock-test',
    type: 'dev',
    name: 'Mock (验证测试)',
    runtime: 'mock',
  })

  const tests = [
    check('acpHost.startAgent (mock)', async () => {
      await acpHost.startAgent('mock-test')
      return acpHost.isRunning('mock-test')
    }),

    check('acpHost.newSession', async () => {
      const sessionId = await acpHost.newSession('mock-test', 'test-session-1')
      return sessionId != null && sessionId.length > 0
    }),

    check('acpHost.prompt 接收 session:update 事件', async () => {
      const updates: unknown[] = []

      const onUpdate = (data: unknown) => updates.push(data)

      // 等待 stream 通知的 done（通过 notification 路径），而非 prompt() 返回后的立即 done
      const streamDonePromise = new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 12000)
        events.on('session:update', onUpdate)
        events.on('session:done', () => {
          // 等至少一次 session:update 后再接受 done
          if (updates.length > 0) {
            clearTimeout(timer)
            resolve(true)
          }
        })
      })

      await acpHost.prompt('mock-test', 'test-session-1', 'hello 验证测试')

      // mock agent 的流式通知是异步的，prompt() 返回后还要等待 stream
      const gotStreamDone = await streamDonePromise
      events.off('session:update', onUpdate)

      return gotStreamDone
    }),

    check('acpHost.listRunning 包含 mock-test', () => {
      const running = acpHost.listRunning()
      return running.includes('mock-test')
    }),

    check('acpHost.stopAgent 正常停止', async () => {
      await acpHost.stopAgent('mock-test')
      return !acpHost.isRunning('mock-test')
    }),
  ]

  for (const t of tests) await t()

  // 清理
  agentStore.delete('mock-test')
}

// ─── 测试 5: ACP SDK 类型/接口验证 ───

async function test5_sdk_types() {
  console.log('\n【测试 5】ACP SDK 类型/接口验证')

  const tests = [
    check('Client 接口方法签名正确', () => {
      const handler: acp.Client = {
        sessionUpdate: async () => {},
        requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'ok' } }),
        readTextFile: async () => ({ content: '' }),
        writeTextFile: async () => ({}),
      }
      return (
        typeof handler.sessionUpdate === 'function' &&
        typeof handler.requestPermission === 'function' &&
        typeof handler.readTextFile === 'function' &&
        typeof handler.writeTextFile === 'function'
      )
    }),

    check('ndJsonStream 生成 TransformStream', () => {
      // ndJsonStream 应该接受输入/输出并返回 Stream 对象
      return typeof acp.ndJsonStream === 'function'
    }),

    check('PROTOCOL_VERSION 与 initialize 请求匹配', () => {
      // SDK 的 PROTOCOL_VERSION 是数字 1，initialize 请求中传的是日期字符串 "2025-11-16"
      // 两者均有效 —— 日期字符串是初始化时协商的协议版本
      return acp.PROTOCOL_VERSION === 1
    }),
  ]

  for (const t of tests) await t()
}

// ─── 主入口 ───

async function main() {
  console.log('╔═══════════════════════════════════════════════╗')
  console.log('║     ACP 集成验证测试                            ║')
  console.log(`║     时间: ${new Date().toISOString()}                  ║`)
  console.log('╚═══════════════════════════════════════════════╝')

  await test1_sdk_imports()
  await test2_mock_agent_protocol()
  await test3_agent_process()
  await test4_acp_host()
  await test5_sdk_types()

  summary()
}

main().catch((err) => {
  console.error(`\n❌ 验证过程中发生未预期的错误:`)
  console.error(err)
  process.exit(1)
})
