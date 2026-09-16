/**
 * 档位线上级取证探针（`EFFORT_WIRE_PROBE=1` 时运行；默认 skip）。
 *
 * 复刻 docs/audit/effort-fix-plan-dev-deepseek.md ② 的实验三件套：
 *   真实 claude CLI（SDK 内置 claude.exe）+ `settings`/`applyFlagSettings` + 本地记录网关。
 * 断言 **线上报文** `output_config.effort`，不看 UI 回显：
 *   A 缺陷复现：继承 env CLAUDE_CODE_EFFORT_LEVEL=max 且无哨兵 → wire=max（界面档位被压过）
 *   B 修复验证：a1 清 spawn env + a2 哨兵 'default'（buildClaudeSessionMeta）→ wire=medium
 *   C 防退化：哨兵换成 'unset' 硬禁用值 → 不得再退化为"忽略界面选择"
 *
 * 跑法：EFFORT_WIRE_PROBE=1 npx vitest run tests/integration/effort-neutralization.test.ts
 * 缺失 claude.exe 或 SDK 时自动 skip（CI 安全）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import http from 'node:http'
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { buildAgentRuntimeEnv, buildClaudeSessionMeta } from '../../src/acp/model-profile-env.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { modelProfileStore } from '../../src/store/model-profiles.js'
import { modelProviderStore } from '../../src/store/model-providers.js'

const CLAUDE_EXE = resolve('node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe')
const sdkAvailable = existsSync(CLAUDE_EXE)
const enabled = process.env.EFFORT_WIRE_PROBE === '1' && sdkAvailable

interface WireCapture { url: string | undefined; effort: unknown; model: unknown; raw: string }

let tmp: string
let upstream: http.Server
let upstreamUrl: string
let captures: WireCapture[] = []

beforeAll(async () => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-effort-probe-'))
  initDatabase(resolve(tmp, 'test.sqlite'))
  if (process.env.EFFORT_WIRE_PROBE_OUT) {
    // 全新 checkout 可能没有 .tmp/：先递归建父目录再落盘。
    mkdirSync(dirname(process.env.EFFORT_WIRE_PROBE_OUT), { recursive: true })
    writeFileSync(process.env.EFFORT_WIRE_PROBE_OUT, '')
  }
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString()
      try {
        const body = JSON.parse(text) as { output_config?: { effort?: unknown }, model?: unknown, thinking?: unknown }
        // 只记真正的模型调用（根路径探测请求不参与断言）。
        if ((req.url ?? '').includes('/v1/messages')) {
          captures.push({ url: req.url, effort: body.output_config?.effort, model: body.model, raw: text })
          // 取证落盘：EFFORT_WIRE_PROBE_OUT=<file> 时把每次捕获写成一行 JSON（供报告引用）。
          if (process.env.EFFORT_WIRE_PROBE_OUT) {
            appendFileSync(process.env.EFFORT_WIRE_PROBE_OUT, `${JSON.stringify({ url: req.url, model: body.model, output_config: body.output_config })}\n`)
          }
        }
        if (process.env.EFFORT_WIRE_PROBE_DEBUG === '1') console.log('[probe]', req.url, JSON.stringify({ keys: Object.keys(body), output_config: body.output_config }))
      } catch { /* 非 JSON 探测请求 */ }
      // 只做记录：返回 400 让 CLI 立即收手（我们只要请求体，不模拟完整对话）。
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'probe recorder' } }))
    })
  })
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done))
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
})

afterAll(() => {
  upstream.closeAllConnections()
  upstream.close()
  closeDatabase()
  // CLI 子进程可能短暂持有临时目录句柄（Windows）：重试清理，不让 EPERM 变成假失败。
  try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* 临时目录残留无害 */ }
})

function setupClaudeAgent() {
  const provider = modelProviderStore.create({
    name: 'probe-provider', displayName: 'Probe', protocol: 'claude',
    baseUrl: `${upstreamUrl}/anthropic`, apiKey: 'sk-probe',
  })
  const profile = modelProfileStore.create({
    name: 'probe-profile', runtime: 'claude', providerId: provider.id,
    config: { defaultModel: 'claude-sonnet-5' },
  })
  const agent = agentStore.create({ name: 'probe', type: 'dev', runtime: 'claude', config: { modelProfileId: profile.id } })
  return agent
}

/** 用真实 SDK 起一轮 CLI 会话；返回本次的线上捕获。 */
async function runProbe(input: {
  agent: ReturnType<typeof setupClaudeAgent>
  baseEnv: NodeJS.ProcessEnv
  effortFlag: 'medium'
  sentinel?: string
  purgeEffortEnv: boolean
}): Promise<WireCapture[]> {
  const prepared = buildAgentRuntimeEnv(input.agent.runtime, input.agent, { ...input.baseEnv })
  if (!input.purgeEffortEnv) {
    prepared.env.CLAUDE_CODE_EFFORT_LEVEL = 'max'
  }
  const meta = buildClaudeSessionMeta(prepared.env, 'claude')
  const settings = structuredClone(meta!.claudeCode.options.settings)
  if (input.sentinel === undefined) delete settings.env?.CLAUDE_CODE_EFFORT_LEVEL
  else if (settings.env) settings.env.CLAUDE_CODE_EFFORT_LEVEL = input.sentinel

  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  captures = []
  const q = query({
    prompt: 'reply with the single word ok',
    options: {
      cwd: tmp,
      env: Object.fromEntries(Object.entries(prepared.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      settings,
      maxTurns: 1,
      pathToClaudeCodeExecutable: CLAUDE_EXE,
      permissionMode: 'bypassPermissions',
      model: 'claude-sonnet-5',
    },
  })
  await q.applyFlagSettings({ effortLevel: input.effortFlag })
  // 消费消息流直到 CLI 发完请求（400 后 CLI 会以错误收尾）；超时兜底。
  const deadline = Date.now() + 30_000
  try {
    for await (const message of q) {
      if (captures.length > 0 || Date.now() > deadline) break
      void message
    }
  } catch { /* 记录器返回 400，CLI 抛错属预期 */ }
  try { await q.interrupt() } catch { /* 已结束 */ }
  return captures
}

describe.skipIf(!enabled)('effort wire-level probe (real claude CLI)', () => {
  test('A: inherited CLAUDE_CODE_EFFORT_LEVEL=max without the sentinel overrides the UI level (defect repro)', async () => {
    const agent = setupClaudeAgent()
    const captured = await runProbe({ agent, baseEnv: { ...process.env }, effortFlag: 'medium', purgeEffortEnv: false })
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0].effort).toBe('max')
  }, 60_000)

  test('B: a1 purge + a2 sentinel default lets the UI level reach the wire (fix proof)', async () => {
    const agent = setupClaudeAgent()
    const captured = await runProbe({
      agent, baseEnv: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: 'max', CLAUDE_EFFORT: 'max' },
      effortFlag: 'medium', sentinel: 'default', purgeEffortEnv: true,
    })
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0].effort).toBe('medium')
  }, 60_000)

  test('C: the unset sentinel must not be used (hard-disable regression guard)', async () => {
    const agent = setupClaudeAgent()
    const captured = await runProbe({
      agent, baseEnv: { ...process.env }, effortFlag: 'medium', sentinel: 'unset', purgeEffortEnv: true,
    })
    // 'unset' 语义＝CLI 移除 effort 字段并忽略界面选择：与本修复目标相反（哨兵必须是 'default'）。
    expect(captured[0]?.effort).not.toBe('medium')
  }, 60_000)
})
