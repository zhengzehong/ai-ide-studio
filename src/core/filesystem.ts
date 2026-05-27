import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
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

export interface FileContent {
  path: string
  content: string
  size: number
  extension: string
  language: string
  truncated: boolean
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
    if (IGNORE_DIRS.has(name) || IGNORE_FILES.has(name)) continue
    if (name.startsWith('.') && name !== '.env.example') continue

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
  const fullPath = join(workDir, filePath)
  const normalizedRel = relative(workDir, fullPath)
  if (normalizedRel.startsWith('..')) {
    log.warn({ workDir, filePath }, '路径逃逸尝试')
    return null
  }

  if (!existsSync(fullPath)) return null

  try {
    const stat = statSync(fullPath)
    if (!stat.isFile()) return null

    const ext = extname(fullPath).toLowerCase()
    const language = EXT_TO_LANG[ext] || 'plaintext'
    const truncated = stat.size > MAX_FILE_SIZE
    const content = readFileSync(fullPath, 'utf-8').slice(0, MAX_FILE_SIZE)

    return {
      path: filePath,
      content,
      size: stat.size,
      extension: ext,
      language,
      truncated,
    }
  } catch (err) {
    log.error({ err, path: fullPath }, '读取文件失败')
    return null
  }
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
