import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JournalEntry, SendFrame } from './types.js'

const LOG_LIMIT = 10 * 1024 * 1024

export class JobJournal {
  constructor(private readonly directory: string) { mkdirSync(directory, { recursive: true }) }

  get(id: string): JournalEntry | undefined {
    const path = this.path(id, '.json')
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as JournalEntry : undefined
  }

  save(entry: JournalEntry): void {
    const path = this.path(entry.id, '.json')
    writeFileSync(`${path}.tmp`, JSON.stringify(entry))
    renameSync(`${path}.tmp`, path)
  }

  append(id: string, text: string, send: SendFrame): boolean {
    const path = this.path(id, '.log')
    const offset = existsSync(path) ? statSync(path).size : 0
    const buffer = Buffer.from(text)
    // Never split a code point at the durable log limit.
    const remaining = LOG_LIMIT - offset
    let value = buffer.length <= remaining ? text : buffer.subarray(0, Math.max(0, remaining)).toString('utf8').replace(/\ufffd$/, '')
    if (value) {
      appendFileSync(path, value)
      let cursor = offset
      while (value) {
        let end = Math.min(8000, value.length)
        if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end--
        const chunk = value.slice(0, end)
        send({ type: 'job.log', jobId: id, offset: cursor, text: chunk })
        cursor += Buffer.byteLength(chunk)
        value = value.slice(end)
      }
    }
    return buffer.length > remaining
  }

  replay(id: string, send: SendFrame, cursor = 0): void {
    const path = this.path(id, '.log')
    if (!existsSync(path)) return
    const buffer = readFileSync(path)
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > buffer.length) throw new Error('日志游标无效')
    const text = buffer.subarray(cursor).toString('utf8')
    let offset = cursor
    for (let i = 0; i < text.length;) {
      let end = Math.min(i + 8000, text.length)
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--
      const chunk = text.slice(i, end)
      send({ type: 'job.log', jobId: id, offset, text: chunk })
      offset += Buffer.byteLength(chunk)
      i = end
    }
  }

  private path(id: string, extension: string): string {
    if (!/^djob-[0-9a-f-]{36}$/.test(id)) throw new Error('作业 ID 无效')
    return join(this.directory, `${id}${extension}`)
  }
}
