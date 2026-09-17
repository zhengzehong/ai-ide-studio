import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join, relative, extname, basename, dirname, isAbsolute, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { createChildLogger } from './logger.js'
import type { FileByteRange } from './file-byte-range.js'

const log = createChildLogger('fs')

const MAX_FILE_SIZE = 1024 * 1024
const MAX_TREE_DEPTH = 10
const MAX_ENTRIES = 500
/** 目录扫描的并发 stat/readdir 上限(P0-1):够快,又不会把 libuv 线程池打满。 */
const SIBLING_SCAN_CONCURRENCY = 32

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.idea', '.vscode',
  'coverage', '.cache', '.turbo', '.output',
])

const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env', '.env.local'])

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  extension?: string
  children?: FileEntry[]
  /** 该目录的子项超过 MAX_ENTRIES 被截断(仅目录条目、且仅在该层真的截断时出现)。 */
  truncated?: boolean
}

export type FileKind = 'text' | 'image' | 'audio' | 'video' | 'binary'

export interface FileContent {
  path: string
  content: string
  size: number
  extension: string
  language: string
  truncated: boolean
  kind: FileKind
}

export interface FileAssetInfo {
  path: string
  size: number
  extension: string
  kind: FileKind
  mimeType: string
}

export interface FileMetadata {
  path: string
  name: string
  size: number
  extension: string
  language: string
  kind: FileKind
}

export interface FileReferenceInfo {
  path: string
  name: string
  kind: 'file' | 'directory'
  absolute: boolean
}

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.md': 'markdown', '.mdx': 'markdown', '.html': 'html', '.css': 'css',
  '.scss': 'scss', '.less': 'less', '.sql': 'sql', '.sh': 'shell',
  '.bash': 'shell', '.ps1': 'powershell', '.xml': 'xml', '.svg': 'xml',
  '.vue': 'vue', '.svelte': 'svelte', '.graphql': 'graphql',
  '.dockerfile': 'dockerfile', '.env': 'dotenv', '.txt': 'plaintext',
  '.log': 'plaintext', '.ini': 'ini', '.conf': 'ini', '.env.example': 'dotenv',
  '.properties': 'properties', '.csv': 'csv', '.tsv': 'csv',
  '.rb': 'ruby', '.php': 'php', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'csharp',
  '.swift': 'swift', '.kt': 'kotlin', '.dart': 'dart',
  '.lua': 'lua', '.r': 'r', '.scala': 'scala',
  '.clj': 'clojure', '.ex': 'elixir', '.exs': 'elixir',
  '.erl': 'erlang', '.hs': 'haskell', '.ml': 'ocaml',
  '.pl': 'perl', '.asm': 'asm', '.wasm': 'wasm',
  '.proto': 'proto', '.thrift': 'thrift',
}

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
])

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.flac', '.opus'])
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov'])

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

const BINARY_MIME_FALLBACK: Record<string, string> = {
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.exe': 'application/x-msdownload',
  '.dll': 'application/x-msdownload',
  '.so': 'application/x-sharedlib',
  '.dylib': 'application/x-sharedlib',
  '.class': 'application/x-java-applet',
  '.jar': 'application/java-archive',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function classifyExtension(ext: string): FileKind {
  if (IMAGE_EXTS.has(ext) || ext === '.svg') return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (EXT_TO_LANG[ext]) return 'text'
  return 'binary'
}

function classifyReadableFile(filePath: string, ext: string): FileKind {
  const kind = classifyExtension(ext)
  if (kind !== 'binary') return kind
  if (basename(filePath).toLowerCase() === '.env.example') return 'text'
  return looksLikeTextFile(filePath) ? 'text' : kind
}

function looksLikeTextFile(filePath: string): boolean {
  const descriptor = openSync(filePath, 'r')
  try {
    const sample = Buffer.alloc(8192)
    const bytesRead = readSync(descriptor, sample, 0, sample.length, 0)
    return !sample.subarray(0, bytesRead).includes(0)
  } finally {
    closeSync(descriptor)
  }
}

export function resolveMimeType(ext: string, kind: FileKind): string {
  const lower = ext.toLowerCase()
  if (kind === 'image') return IMAGE_MIME[lower] ?? 'image/*'
  if (kind === 'audio') return BINARY_MIME_FALLBACK[lower] ?? 'audio/*'
  if (kind === 'video') return BINARY_MIME_FALLBACK[lower] ?? 'video/*'
  return BINARY_MIME_FALLBACK[lower] ?? 'application/octet-stream'
}

export function isHiddenPathRel(filePath: string): boolean {
  return filePath.split(/[\\/]+/).some((part) => part.length > 0 && isHiddenFileTreeEntry(part))
}

function resolveSafePath(workDir: string, filePath: string): string | null {
  if (!filePath) {
    log.warn({ workDir, filePath }, 'blocked empty file path')
    return null
  }
  if (isAbsolute(filePath)) return resolve(filePath)

  const fullPath = resolve(workDir, filePath)
  const normalizedRel = relative(workDir, fullPath)
  if (normalizedRel === '..' || normalizedRel.startsWith(`..${sep}`) || isAbsolute(normalizedRel)) {
    log.warn({ workDir, filePath }, '路径逃逸尝试')
    return null
  }
  if (isHiddenPathRel(normalizedRel)) {
    log.warn({ workDir, filePath }, 'blocked hidden file read')
    return null
  }
  return fullPath
}

function resolvedFilePath(workDir: string, filePath: string, fullPath: string): string {
  return isAbsolute(filePath) ? fullPath : relative(workDir, fullPath).replace(/\\/g, '/')
}

export function resolveFileReference(workDir: string, filePath: string, basePath?: string): string | null {
  const decodedPath = decodeFileReference(filePath)
  if (!decodedPath) return null
  if (!basePath) {
    const fullPath = resolveSafePath(workDir, decodedPath)
    return fullPath ? resolvedFilePath(workDir, decodedPath, fullPath) : null
  }

  // Markdown `/assets/a.png` means project-root relative. Explicit OS paths use
  // a drive, UNC path, or file:// URI and keep the existing privileged behavior.
  if (/^\/(?!\/)/.test(decodedPath)) {
    const projectPath = decodedPath.replace(/^\/+/, '')
    const fullPath = resolveSafePath(workDir, projectPath)
    return fullPath ? resolvedFilePath(workDir, projectPath, fullPath) : null
  }
  if (isAbsolute(decodedPath)) return resolve(decodedPath)

  const decodedBase = decodeFileReference(basePath)
  if (!decodedBase) return null
  const baseFullPath = resolveSafePath(workDir, decodedBase)
  if (!baseFullPath) return null
  const fullPath = resolve(dirname(baseFullPath), decodedPath)
  if (isAbsolute(decodedBase)) return fullPath

  const projectRelative = relative(workDir, fullPath)
  const validated = resolveSafePath(workDir, projectRelative)
  return validated ? relative(workDir, validated).replace(/\\/g, '/') : null
}

function decodeFileReference(filePath: string): string | null {
  const trimmed = filePath.trim()
  if (!trimmed) return null
  if (/^file:/i.test(trimmed)) {
    try { return fileURLToPath(trimmed) } catch { return null }
  }
  const withoutSuffix = trimmed.split(/[?#]/, 1)[0]
  try { return decodeURIComponent(withoutSuffix) } catch { return withoutSuffix }
}

export function inspectFile(workDir: string, filePath: string): FileMetadata | null {
  const fullPath = resolveSafePath(workDir, filePath)
  if (!fullPath || !existsSync(fullPath)) return null
  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null
    const extension = extname(fullPath).toLowerCase()
    return {
      path: resolvedFilePath(workDir, filePath, fullPath),
      name: basename(fullPath),
      size: stat.size,
      extension,
      language: EXT_TO_LANG[extension] || 'plaintext',
      kind: classifyReadableFile(fullPath, extension),
    }
  } catch (err) {
    log.error({ err, path: fullPath }, 'inspect file failed')
    return null
  }
}

export function inspectFileReference(workDir: string, filePath: string, basePath = 'chat.md'): FileReferenceInfo | null {
  const resolvedPath = resolveFileReference(workDir, filePath, basePath)
  if (!resolvedPath) return null
  const fullPath = resolveSafePath(workDir, resolvedPath)
  if (!fullPath || !existsSync(fullPath)) return null
  try {
    const stat = statSync(fullPath)
    if (!stat.isFile() && !stat.isDirectory()) return null
    return {
      path: resolvedFilePath(workDir, resolvedPath, fullPath),
      name: basename(fullPath),
      kind: stat.isDirectory() ? 'directory' : 'file',
      absolute: isAbsolute(resolvedPath),
    }
  } catch (err) {
    log.error({ err, path: fullPath }, 'inspect file reference failed')
    return null
  }
}

export async function listDirectory(workDir: string, subPath?: string): Promise<FileEntry[]> {
  const resolvedPath = subPath ? resolveFileReference(workDir, subPath, 'chat.md') : ''
  if (subPath && !resolvedPath) return []
  const fullPath = resolvedPath ? resolveSafePath(workDir, resolvedPath) : workDir
  if (!fullPath) return []
  if (!existsSync(fullPath)) {
    log.warn({ workDir, subPath }, '目录不存在')
    return []
  }

  const tree = await readTree(fullPath, workDir, 0, !!resolvedPath && isAbsolute(resolvedPath))
  if (tree.truncated) {
    // 顶层截断没有父条目可挂 truncated 标志(RPC 响应仍是 FileEntry[]),
    // 至少让它在服务端可观测;需要 UI 提示时再扩响应契约。
    log.warn({ workDir, subPath, maxEntries: MAX_ENTRIES }, '目录项超过上限,顶层列表已截断')
  }
  return tree.entries
}

/**
 * 目录树扫描(P0-1 异步化)。
 * - readdir 用 withFileTypes:目录条目直接由 dirent 判定,免一次 stat(实测目录占 28.6%)
 * - stat 只用于「文件取 size」与「符号链接跟随」,并发受 SIBLING_SCAN_CONCURRENCY 限制
 * - 错误语义与同步版一致:readdir 失败返回 [] 并 debug;条目 stat 失败静默跳过
 * - 截断改为「排序后截断」:返回目录优先+名称序的前 MAX_ENTRIES 项(确定性),
 *   不再依赖 OS 原生目录序;被截断的那一层通过 truncated 上报
 */
async function readTree(
  dirPath: string,
  rootPath: string,
  depth: number,
  absolutePaths = false,
): Promise<TreeScanResult> {
  if (depth > MAX_TREE_DEPTH) return { entries: [], truncated: false }

  let dirents: Dirent[]
  try {
    dirents = await readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    log.debug({ err, path: dirPath }, '读取目录失败')
    return { entries: [], truncated: false }
  }

  const candidates = dirents
    .filter((entry) => !isHiddenFileTreeEntry(entry.name))
    .sort((left, right) => {
      // 目录优先 + 名称序:先排序再截断,保证"返回的是确定的前 N 项"
      const leftDir = left.isDirectory()
      const rightDir = right.isDirectory()
      if (leftDir !== rightDir) return leftDir ? -1 : 1
      return left.name.localeCompare(right.name)
    })
  const truncated = candidates.length > MAX_ENTRIES
  const limited = truncated ? candidates.slice(0, MAX_ENTRIES) : candidates

  const limit = createLimiter(SIBLING_SCAN_CONCURRENCY)
  const scanned = await Promise.all(
    limited.map((entry) => limit(() => toFileEntry(dirPath, rootPath, entry, depth, absolutePaths))),
  )
  return { entries: scanned.filter((entry): entry is FileEntry => entry !== undefined), truncated }
}

async function toFileEntry(
  dirPath: string,
  rootPath: string,
  entry: Dirent,
  depth: number,
  absolutePaths: boolean,
): Promise<FileEntry | undefined> {
  const fullPath = join(dirPath, entry.name)
  const relPath = absolutePaths ? fullPath : relative(rootPath, fullPath).replace(/\\/g, '/')

  const asDirectory = async (): Promise<FileEntry> => {
    const children = depth < 2 ? await readTree(fullPath, rootPath, depth + 1, absolutePaths) : undefined
    return {
      name: entry.name,
      path: relPath,
      type: 'directory',
      children: children?.entries,
      // 只在本层真的被截断时置位,避免给每个目录都挂一个 undefined 字段
      ...(children?.truncated ? { truncated: true } : {}),
    }
  }

  try {
    // 目录免 stat;符号链接仍需 stat 跟随(保持"软链目录可展开"的既有语义)
    if (entry.isDirectory()) return await asDirectory()
    if (entry.isSymbolicLink()) {
      const linked = await stat(fullPath)
      if (linked.isDirectory()) return await asDirectory()
      if (!linked.isFile()) return undefined
      return {
        name: entry.name,
        path: relPath,
        type: 'file',
        size: linked.size,
        extension: extname(entry.name).toLowerCase(),
      }
    }
    if (!entry.isFile()) return undefined
    const stats = await stat(fullPath)
    return { name: entry.name, path: relPath, type: 'file', size: stats.size, extension: extname(entry.name).toLowerCase() }
  } catch {
    // skip inaccessible entries(与同步版一致)
    return undefined
  }
}

interface TreeScanResult {
  entries: FileEntry[]
  truncated: boolean
}

/** 极简并发闸:限制同时进行的 stat/readdir 数量,避免大目录把 libuv 线程池打满。 */
function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve))
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      const resume = waiting.shift()
      if (resume) resume()
    }
  }
}

export function readFile(workDir: string, filePath: string): FileContent | null {
  const fullPath = resolveSafePath(workDir, filePath)
  if (!fullPath || !existsSync(fullPath)) return null

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null

    const ext = extname(fullPath).toLowerCase()
    const kind = classifyReadableFile(fullPath, ext)
    const language = EXT_TO_LANG[ext] || 'plaintext'

    if (kind !== 'text') {
      return {
        path: resolvedFilePath(workDir, filePath, fullPath),
        content: '',
        size: stat.size,
        extension: ext,
        language,
        truncated: false,
        kind,
      }
    }

    const truncated = stat.size > MAX_FILE_SIZE
    const content = readFileSync(fullPath, 'utf-8').slice(0, MAX_FILE_SIZE)

    return {
      path: resolvedFilePath(workDir, filePath, fullPath),
      content,
      size: stat.size,
      extension: ext,
      language,
      truncated,
      kind,
    }
  } catch (err) {
    log.error({ err, path: fullPath }, '读取文件失败')
    return null
  }
}

export function getAssetStream(
  workDir: string,
  filePath: string,
  range?: FileByteRange,
): FileAssetInfo & { stream: NodeJS.ReadableStream } | null {
  const fullPath = resolveSafePath(workDir, filePath)
  if (!fullPath || !existsSync(fullPath)) return null

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null
    const ext = extname(fullPath).toLowerCase()
    const kind = classifyExtension(ext)
    return {
      path: resolvedFilePath(workDir, filePath, fullPath),
      size: stat.size,
      extension: ext,
      kind,
      mimeType: resolveMimeType(ext, kind),
      stream: createReadStream(fullPath, range ? { start: range.start, end: range.end } : undefined),
    }
  } catch (err) {
    log.error({ err, path: fullPath }, '获取文件流失败')
    return null
  }
}

function isHiddenFileTreeEntry(name: string): boolean {
  return IGNORE_DIRS.has(name) || IGNORE_FILES.has(name) || (name.startsWith('.') && name !== '.env.example')
}

export function expandDirectory(workDir: string, dirPath: string): Promise<FileEntry[]> {
  return listDirectory(workDir, dirPath)
}

export function getFileBaseName(filePath: string): string {
  return basename(filePath)
}
