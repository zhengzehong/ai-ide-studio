import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolveRealtimeEntryPath(parentUrl: string): string {
  const jsUrl = new URL('./entry.js', parentUrl)
  if (existsSync(fileURLToPath(jsUrl))) return fileURLToPath(jsUrl)
  const tsUrl = new URL('./entry.ts', parentUrl)
  if (existsSync(fileURLToPath(tsUrl))) return fileURLToPath(tsUrl)
  throw new Error('Realtime process entry was not found')
}
