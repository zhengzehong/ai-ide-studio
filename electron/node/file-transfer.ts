import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { NodeRequest } from './types.js'

export async function runNodeFileTransfer(request: NodeRequest, origin: string, token: string, signal: AbortSignal): Promise<void> {
  const transfer = request.transfer
  if (!transfer || !request.localPath || !isAbsolute(request.localPath) || !Number.isSafeInteger(transfer.maxBytes) || transfer.maxBytes <= 0) throw new Error('文件传输参数无效')
  const url = new URL(transfer.url, origin)
  if (url.origin !== new URL(origin).origin || !/^\/node\/files\/djob-[0-9a-f-]{36}$/.test(url.pathname)) throw new Error('文件传输端点无效')
  const headers = { Authorization: `Bearer ${token}`, 'x-device-ticket': transfer.ticket }
  const abort = new AbortController()
  const combined = AbortSignal.any([signal, abort.signal, AbortSignal.timeout(30 * 60_000)])
  let idle: NodeJS.Timeout
  const progress = (): void => { clearTimeout(idle); idle = setTimeout(() => abort.abort(new Error('文件传输 60 秒无进展')), 60_000) }
  progress()
  try {
    if (request.type === 'file.upload') {
      const path = await realpath(request.localPath)
      const before = await stat(path)
      if (!before.isFile() || before.size > transfer.maxBytes) throw new Error('上传源不是普通文件或超过大小限制')
      const sha256 = await hashFile(path, combined, progress)
      const after = await stat(path)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('源文件正在变化，请重试')
      const source = createReadStream(path, { signal: combined })
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback): void { progress(); callback(null, chunk) } })
      source.once('error', (error) => meter.destroy(error))
      meter.once('close', () => source.destroy())
      const init: RequestInit & { duplex: 'half' } = {
        method: 'PUT', headers: { ...headers, 'Content-Length': String(before.size), 'x-file-sha256': sha256 },
        body: Readable.toWeb(source.pipe(meter)) as ReadableStream<Uint8Array>,
        duplex: 'half', signal: combined, redirect: 'error',
      }
      const response = await fetch(url, init)
      if (!response.ok) throw new Error(`文件上传失败（HTTP ${response.status}）`)
      const result = await response.json() as { size?: number; sha256?: string }
      if (result.size !== before.size || result.sha256 !== sha256) throw new Error('上传结果校验失败')
      return
    }
    const parent = await realpath(dirname(request.localPath))
    const target = join(parent, basename(request.localPath))
    const temporary = join(parent, `.ai-ide-${randomUUID()}.partial`)
    if (typeof transfer.size !== 'number' || transfer.size > transfer.maxBytes || !transfer.sha256) throw new Error('下载文件元数据无效')
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: combined })
      if (!response.ok || !response.body) throw new Error(`文件下载失败（HTTP ${response.status}）`)
      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback): void {
        progress(); size += chunk.length
        if (size > transfer.maxBytes) { callback(new Error('文件超过大小限制')); return }
        hash.update(chunk); callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        meter, createWriteStream(temporary, { flags: 'wx' }), { signal: combined })
      if (size !== transfer.size || hash.digest('hex') !== transfer.sha256) throw new Error('下载文件大小或 SHA256 校验失败')
      if (combined.aborted) throw new Error('文件传输已取消')
      if (request.overwrite) await rename(temporary, target)
      else { await link(temporary, target); await unlink(temporary) }
    } finally { await unlink(temporary).catch(() => undefined) }
  } finally { clearTimeout(idle!) }
}

async function hashFile(path: string, signal: AbortSignal, progress: () => void): Promise<string> {
  const hash = createHash('sha256')
  const source = createReadStream(path, { signal })
  for await (const chunk of source) { progress(); hash.update(chunk as Buffer) }
  return hash.digest('hex')
}
