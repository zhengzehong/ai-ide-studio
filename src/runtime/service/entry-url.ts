import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function resolveRuntimeEntryPath(parentUrl: string): string {
  const jsUrl = new URL('../service/entry.js', parentUrl)
  if (existsSync(fileURLToPath(jsUrl))) return fileURLToPath(jsUrl)
  const tsUrl = new URL('../service/entry.ts', parentUrl)
  if (existsSync(fileURLToPath(tsUrl))) return fileURLToPath(tsUrl)
  throw new Error('Runtime process entry was not found')
}
