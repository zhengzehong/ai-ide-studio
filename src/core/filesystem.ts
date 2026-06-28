import { readdirSync, readFileSync, statSync, existsSync, createReadStream } from 'fs'
import { join, relative, extname, basename } from 'path'
import { createChildLogger } from './logger.js'

const log = createChildLogger('fs')

const MAX_FILE_SIZE = 1024 * 1024
const MAX_TREE_DEPTH = 10
const MAX_ENTRIES = 500

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
}

export type FileKind = 'text' | 'image' | 'binary'

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
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
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
  if (EXT_TO_LANG[ext]) return 'text'
  return 'binary'
}

function classifyReadableFile(filePath: string, ext: string): FileKind {
  const kind = classifyExtension(ext)
  if (kind !== 'binary') return kind
  if (basename(filePath).toLowerCase() === '.env.example') return 'text'
  return kind
}

export function resolveMimeType(ext: string, kind: FileKind): string {
  const lower = ext.toLowerCase()
  if (kind === 'image') return IMAGE_MIME[lower] ?? 'image/*'
  return BINARY_MIME_FALLBACK[lower] ?? 'application/octet-stream'
}

export function isHiddenPathRel(filePath: string): boolean {
  return filePath.split(/[\\/]+/).some((part) => part.length > 0 && isHiddenFileTreeEntry(part))
}

function resolveSafePath(workDir: string, filePath: string): string | null {
  const fullPath = join(workDir, filePath)
  const normalizedRel = relative(workDir, fullPath)
  if (normalizedRel.startsWith('..')) {
    log.warn({ workDir, filePath }, '路径逃逸尝试')
    return null
  }
  if (isHiddenPathRel(normalizedRel)) {
    log.warn({ workDir, filePath }, 'blocked hidden file read')
    return null
  }
  return fullPath
}

export function listDirectory(workDir: string, subPath?: string): FileEntry[] {
  const fullPath = subPath ? join(workDir, subPath) : workDir
  if (!existsSync(fullPath)) {
    log.warn({ workDir, subPath }, '目录不存在')
    return []
  }

  return readTree(fullPath, workDir, 0)
}

function readTree(dirPath: string, rootPath: string, depth: number): FileEntry[] {
  if (depth > MAX_TREE_DEPTH) return []

  let entries: string[]
  try {
    entries = readdirSync(dirPath)
  } catch (err) {
    log.debug({ err, path: dirPath }, '读取目录失败')
    return []
  }

  const result: FileEntry[] = []

  for (const name of entries) {
    if (result.length >= MAX_ENTRIES) break
    if (isHiddenFileTreeEntry(name)) continue

    const fullPath = join(dirPath, name)
    const relPath = relative(rootPath, fullPath).replace(/\\/g, '/')

    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        const children = depth < 2 ? readTree(fullPath, rootPath, depth + 1) : undefined
        result.push({ name, path: relPath, type: 'directory', children })
      } else if (stat.isFile()) {
        result.push({
          name,
          path: relPath,
          type: 'file',
          size: stat.size,
          extension: extname(name).toLowerCase(),
        })
      }
    } catch {
      // skip inaccessible entries
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return result
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
        path: filePath,
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
      path: filePath,
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

export function getAssetStream(workDir: string, filePath: string): FileAssetInfo & { stream: NodeJS.ReadableStream } | null {
  const fullPath = resolveSafePath(workDir, filePath)
  if (!fullPath || !existsSync(fullPath)) return null

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null
    const ext = extname(fullPath).toLowerCase()
    const kind = classifyExtension(ext)
    return {
      path: filePath,
      size: stat.size,
      extension: ext,
      kind,
      mimeType: resolveMimeType(ext, kind),
      stream: createReadStream(fullPath),
    }
  } catch (err) {
    log.error({ err, path: fullPath }, '获取文件流失败')
    return null
  }
}

function isHiddenFileTreeEntry(name: string): boolean {
  return IGNORE_DIRS.has(name) || IGNORE_FILES.has(name) || (name.startsWith('.') && name !== '.env.example')
}

export function expandDirectory(workDir: string, dirPath: string): FileEntry[] {
  const fullPath = join(workDir, dirPath)
  const normalizedRel = relative(workDir, fullPath)
  if (normalizedRel.startsWith('..')) return []

  return readTree(fullPath, workDir, 0)
}

export function getFileBaseName(filePath: string): string {
  return basename(filePath)
}
