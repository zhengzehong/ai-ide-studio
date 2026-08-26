import type { Command } from 'commander'
import { loadConfig } from '../core/config.js'
import { readRetentionControlToken } from '../data-retention/control-token.js'

interface RetentionResponse {
  error?: string
  [key: string]: unknown
}

export function registerRetentionCommands(program: Command): void {
  const retention = program.command('retention').description('历史执行明细清理')

  retention
    .command('dry-run')
    .description('只统计可清理数据，不写数据库')
    .action(async () => {
      print(await requestRetention('/api/v1/retention/dry-run', 'POST'))
    })
  retention
    .command('delete')
    .description('启动真实清理')
    .option('--confirm', '确认执行删除')
    .action(async (opts) => {
      if (opts.confirm !== true) throw new Error('真实清理必须带 --confirm')
      print(await requestRetention('/api/v1/retention/delete', 'POST', { confirm: true }))
    })
  retention
    .command('status')
    .description('查看清理状态')
    .action(async () => {
      print(await requestRetention('/api/v1/retention/status', 'GET'))
    })
  retention
    .command('stop')
    .description('停止申请新的清理批次')
    .action(async () => {
      print(await requestRetention('/api/v1/retention/stop', 'POST'))
    })
}

async function requestRetention(
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<RetentionResponse> {
  const config = loadConfig()
  const retentionToken = readRetentionControlToken(config.dataDir)
  if (!retentionToken) throw new Error('未找到清理控制令牌，请先启动一次新版 Gateway')
  const response = await fetch(`http://127.0.0.1:${config.port}${path}`, {
    method,
    headers: {
      ...(config.localToken ? { 'x-ai-ide-token': config.localToken } : {}),
      'x-ai-ide-retention-token': retentionToken,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const result = (await response.json()) as RetentionResponse
  if (!response.ok) throw new Error(result.error ?? `Gateway 返回 ${response.status}`)
  return result
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
