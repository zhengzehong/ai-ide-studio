import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolveApiEntryPath(parentUrl: string): string {
  const jsUrl = new URL('./api-entry.js', parentUrl)
  if (existsSync(fileURLToPath(jsUrl))) return fileURLToPath(jsUrl)
  const tsUrl = new URL('./api-entry.ts', parentUrl)
  if (existsSync(fileURLToPath(tsUrl))) return fileURLToPath(tsUrl)
  throw new Error('API process entry was not found')
}
