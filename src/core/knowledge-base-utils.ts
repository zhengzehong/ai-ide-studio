import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { basename, isAbsolute, resolve } from 'path'
import type { SourceFingerprint } from '../store/knowledge-pages.js'

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function parseWikiLinks(body: string): string[] {
  const links: string[] = []
  const pattern = /\[\[([^\]]+)\]\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const text = match[1]?.trim()
    if (text) links.push(text)
  }
  return links
}

export function computeFingerprint(files: string[], baseDir?: string): SourceFingerprint {
  return {
    algorithm: 'sha256',
    files: files.map((path) => {
      const resolvedPath = baseDir && !isAbsolute(path) ? resolve(baseDir, path) : path
      if (!existsSync(resolvedPath)) throw new Error(`SOURCE_FILE_NOT_FOUND: ${path}`)
      const stat = statSync(resolvedPath)
      const hash = createHash('sha256').update(readFileSync(resolvedPath)).digest('hex')
      return { path, hash, size: stat.size, mtimeMs: stat.mtimeMs }
    }),
  }
}

export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function parseFingerprint(value: unknown): SourceFingerprint | null {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value as SourceFingerprint
  if (typeof value !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as SourceFingerprint : null
  } catch {
    return null
  }
}

export function parseSnapshot(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('REVERT_UNSUPPORTED')
  return parsed as Record<string, unknown>
}

export function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20
  return Math.max(1, Math.min(100, Math.floor(value)))
}

export function sourceLabelFromPath(path: string): string {
  return basename(path)
}
