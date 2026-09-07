import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_DEVICE_LOG_BYTES } from './protocol.js'

export class DeviceJobLogs {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true }) }

  size(id: string): number {
    const path = this.path(id)
    return existsSync(path) ? statSync(path).size : 0
  }

  append(id: string, offset: number, text: string): void {
    const path = this.path(id)
    const size = existsSync(path) ? statSync(path).size : 0
    const bytes = Buffer.from(text, 'utf8')
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) throw new Error('设备日志偏移不连续')
    const skip = size - offset
    if (skip >= bytes.length || size >= MAX_DEVICE_LOG_BYTES) return
    appendFileSync(path, bytes.subarray(skip, skip + MAX_DEVICE_LOG_BYTES - size))
  }

  read(id: string, cursor = 0): { output: string; nextCursor: number; hasMore: boolean; truncated: boolean } {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('日志 cursor 无效')
    const path = this.path(id)
    if (!existsSync(path)) return { output: '', nextCursor: 0, hasMore: false, truncated: false }
    const descriptor = openSync(path, 'r')
    try {
      const size = statSync(path).size
      const start = Math.min(cursor, size)
      const buffer = Buffer.alloc(Math.min(32 * 1024, size - start))
      let count = readSync(descriptor, buffer, 0, buffer.length, start)
      // Keep a UTF-8 character spanning a page boundary for the next page.
      if (start + count < size) {
        let lead = count - 1
        while (lead >= 0 && (buffer[lead] & 0xc0) === 0x80) lead--
        if (lead >= 0) {
          const b = buffer[lead]
          const length = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1
          if (lead + length > count) count = lead
        }
      }
      return { output: buffer.subarray(0, count).toString('utf8'), nextCursor: start + count,
        hasMore: start + count < size, truncated: size >= MAX_DEVICE_LOG_BYTES }
    } finally { closeSync(descriptor) }
  }

  private path(id: string): string {
    if (!/^djob-[0-9a-f-]{36}$/.test(id)) throw new Error('作业 ID 无效')
    return join(this.directory, `${id}.log`)
  }
}
