import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TOKEN_FILE = '.retention-control-token'

export function getOrCreateRetentionControlToken(dataDir: string): string {
  const existing = readRetentionControlToken(dataDir)
  if (existing) return existing
  const token = randomBytes(32).toString('hex')
  const path = resolve(dataDir, TOKEN_FILE)
  try {
    writeFileSync(path, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return token
  } catch (err) {
    const raced = readRetentionControlToken(dataDir)
    if (raced) return raced
    throw err
  }
}

export function readRetentionControlToken(dataDir: string): string | undefined {
  try {
    return readFileSync(resolve(dataDir, TOKEN_FILE), 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}
