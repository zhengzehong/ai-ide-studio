import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function resolveDeviceServerSource(base: string, path: string): Promise<string> {
  const root = await realpath(base)
  const full = await realpath(resolve(root, path))
  const rel = relative(root, full)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('服务器源文件超出当前项目目录')
  if (!(await stat(full)).isFile()) throw new Error('源路径不是普通文件')
  return full
}

export async function storeDeviceStream(source: Readable, target: string, maxBytes: number, signal?: AbortSignal): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256')
  let size = 0
  const controller = new AbortController()
  const reset = (): void => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new Error('文件传输 60 秒无进展')), 60_000) }
  let idle = setTimeout(() => controller.abort(), 60_000)
  const life = setTimeout(() => controller.abort(new Error('文件传输超时')), 30 * 60_000)
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      size += chunk.length
      if (size > maxBytes) { callback(new Error('文件超出传输大小限制')); return }
      reset(); hash.update(chunk); callback(null, chunk)
    },
  })
  try {
    await pipeline(source, meter, createWriteStream(target, { flags: 'wx' }), {
      signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    })
    return { size, sha256: hash.digest('hex') }
  } finally { clearTimeout(idle); clearTimeout(life) }
}

export async function snapshotDeviceFile(source: string, target: string, maxBytes: number, signal?: AbortSignal): Promise<{ size: number; sha256: string }> {
  const before = await stat(source)
  if (!before.isFile() || before.size > maxBytes) throw new Error('源文件不是普通文件或超过大小限制')
  const result = await storeDeviceStream(createReadStream(source), target, maxBytes, signal)
  const after = await stat(source)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || result.size !== before.size) throw new Error('源文件传输期间发生变化，请重新提交')
  return result
}
