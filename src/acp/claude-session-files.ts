import { randomUUID } from 'node:crypto'
import {
  cp,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('claude-session-files')
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_SOURCE_READ_ATTEMPTS = 3
const SOURCE_READ_RETRY_MS = 30
const MISSING_OUTPUT_PLACEHOLDER =
  'Historical tool output was removed before this session was cloned; original content is unavailable.\n'

export interface CloneClaudeSessionFilesInput {
  sourceSessionId: string
  targetSessionId: string
  sourceCwd: string
  targetCwd: string
  configDir?: string
  sourceReadAttempts?: number
}

export interface CloneClaudeSessionFilesResult {
  jsonlPath: string
  lineCount: number
  resourceFilesCopied: number
}

export interface ClaudeSessionFilesInput {
  sessionId: string
  cwd: string
  configDir?: string
}

interface RewrittenJsonl {
  content: string
  lineCount: number
  persistedResourcePaths: string[]
}

export async function cloneClaudeSessionFiles(
  input: CloneClaudeSessionFilesInput,
): Promise<CloneClaudeSessionFilesResult> {
  validateSessionId(input.sourceSessionId)
  validateSessionId(input.targetSessionId)
  validateCwd(input.sourceCwd)
  validateCwd(input.targetCwd)
  if (input.sourceSessionId === input.targetSessionId) throw new Error('Source and target Session IDs must differ')

  const configDir = resolveClaudeConfigDir(input.configDir)
  const sourceProjectDir = resolveClaudeProjectDir(configDir, input.sourceCwd)
  const targetProjectDir = resolveClaudeProjectDir(configDir, input.targetCwd)
  const sourceJsonl = resolveWithin(sourceProjectDir, `${input.sourceSessionId}.jsonl`)
  const targetJsonl = resolveWithin(targetProjectDir, `${input.targetSessionId}.jsonl`)
  const sourceResources = resolveWithin(sourceProjectDir, input.sourceSessionId)
  const targetResources = resolveWithin(targetProjectDir, input.targetSessionId)
  const suffix = randomUUID()
  const temporaryJsonl = resolveWithin(targetProjectDir, `.${input.targetSessionId}.jsonl.tmp-${suffix}`)
  const temporaryResources = resolveWithin(targetProjectDir, `.${input.targetSessionId}.resources.tmp-${suffix}`)
  let publishedResources = false

  await mkdir(targetProjectDir, { recursive: true })
  if (await pathExists(targetJsonl) || await pathExists(targetResources)) {
    throw new Error(`Target Claude Session already exists: ${input.targetSessionId}`)
  }

  try {
    const sourceContent = await readCompleteJsonl(
      sourceJsonl,
      input.sourceReadAttempts ?? DEFAULT_SOURCE_READ_ATTEMPTS,
    )
    const rewritten = rewriteJsonl(sourceContent, {
      sourceSessionId: input.sourceSessionId,
      targetSessionId: input.targetSessionId,
      sourceCwd: input.sourceCwd,
      targetCwd: input.targetCwd,
      sourceResources,
      targetResources,
    })

    const sourceResourcesExist = await pathExists(sourceResources)
    const persistedResourcePaths = [...rewritten.persistedResourcePaths]

    let resourceFilesCopied = 0
    if (sourceResourcesExist) {
      await cp(sourceResources, temporaryResources, { recursive: true, errorOnExist: true, force: false })
      persistedResourcePaths.push(...await rewriteCompanionJsonl(temporaryResources, {
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceCwd: input.sourceCwd,
        targetCwd: input.targetCwd,
        sourceResources,
        targetResources,
      }))
    } else if (persistedResourcePaths.length > 0) {
      await mkdir(temporaryResources, { recursive: true })
    }
    if (sourceResourcesExist || persistedResourcePaths.length > 0) {
      await materializePersistedResources(persistedResourcePaths, {
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        sourceResources,
        temporaryResources,
      })
      resourceFilesCopied = await countFiles(temporaryResources)
    }

    await writeFile(temporaryJsonl, rewritten.content, { encoding: 'utf8', flag: 'wx' })
    if (sourceResourcesExist) {
      await rename(temporaryResources, targetResources)
      publishedResources = true
    }
    await link(temporaryJsonl, targetJsonl)
    await rm(temporaryJsonl, { force: true })

    log.info({
      sourceSessionId: input.sourceSessionId,
      targetSessionId: input.targetSessionId,
      sourceCwd: input.sourceCwd,
      targetCwd: input.targetCwd,
      lineCount: rewritten.lineCount,
      resourceFilesCopied,
    }, 'Claude Session files materialized')
    return { jsonlPath: targetJsonl, lineCount: rewritten.lineCount, resourceFilesCopied }
  } catch (error) {
    await rm(temporaryJsonl, { force: true }).catch(() => undefined)
    await rm(temporaryResources, { recursive: true, force: true }).catch(() => undefined)
    if (publishedResources) await rm(targetResources, { recursive: true, force: true }).catch(() => undefined)
    log.error({
      err: error,
      sourceSessionId: input.sourceSessionId,
      targetSessionId: input.targetSessionId,
      sourceCwd: input.sourceCwd,
      targetCwd: input.targetCwd,
    }, 'Claude Session file materialization failed')
    throw error
  }
}

export async function hasClaudeSessionFiles(input: ClaudeSessionFilesInput): Promise<boolean> {
  validateSessionId(input.sessionId)
  validateCwd(input.cwd)
  const projectDir = resolveClaudeProjectDir(resolveClaudeConfigDir(input.configDir), input.cwd)
  return pathExists(resolveWithin(projectDir, `${input.sessionId}.jsonl`))
}

export async function removeClaudeSessionFiles(input: ClaudeSessionFilesInput): Promise<void> {
  validateSessionId(input.sessionId)
  validateCwd(input.cwd)
  const configDir = resolveClaudeConfigDir(input.configDir)
  const projectDir = resolveClaudeProjectDir(configDir, input.cwd)
  const jsonl = resolveWithin(projectDir, `${input.sessionId}.jsonl`)
  const resources = resolveWithin(projectDir, input.sessionId)
  await rm(jsonl, { force: true })
  await rm(resources, { recursive: true, force: true })
  log.info({ sessionId: input.sessionId, cwd: input.cwd }, 'Claude Session files removed')
}

export function encodeClaudeProjectPath(cwd: string): string {
  validateCwd(cwd)
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

function resolveClaudeConfigDir(configDir?: string): string {
  const value = configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  if (!isAbsolute(value)) throw new Error(`Claude config directory must be absolute: ${value}`)
  return resolve(value)
}

function resolveClaudeProjectDir(configDir: string, cwd: string): string {
  const projectsRoot = resolve(configDir, 'projects')
  return resolveWithin(projectsRoot, encodeClaudeProjectPath(cwd))
}

function resolveWithin(root: string, child: string): string {
  const resolvedRoot = resolve(root)
  const resolvedChild = resolve(resolvedRoot, child)
  const pathFromRoot = relative(resolvedRoot, resolvedChild)
  if (!pathFromRoot || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw new Error(`Claude Session path escapes its storage root: ${resolvedChild}`)
  }
  return resolvedChild
}

async function readCompleteJsonl(path: string, attempts: number): Promise<string> {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error(`sourceReadAttempts must be between 1 and 10: ${attempts}`)
  }
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const handle = await open(path, 'r')
      try {
        const snapshotSize = (await handle.stat()).size
        if (snapshotSize < 1) throw new Error('Source Claude Session has no complete JSON line')
        const buffer = Buffer.allocUnsafe(snapshotSize)
        let offset = 0
        while (offset < snapshotSize) {
          const result = await handle.read(buffer, offset, snapshotSize - offset, offset)
          if (result.bytesRead === 0) break
          offset += result.bytesRead
        }
        if (offset !== snapshotSize || buffer[snapshotSize - 1] !== 0x0a) {
          throw new Error('Source Claude Session has no complete JSON line')
        }
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        for (const line of content.trimEnd().split(/\r?\n/)) JSON.parse(line)
        return content
      } finally {
        await handle.close()
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt < attempts) await delay(SOURCE_READ_RETRY_MS)
    }
  }
  throw lastError ?? new Error(`Unable to read Claude Session JSONL: ${path}`)
}

function rewriteJsonl(
  content: string,
  context: {
    sourceSessionId: string
    targetSessionId: string
    sourceCwd: string
    targetCwd: string
    sourceResources: string
    targetResources: string
  },
): RewrittenJsonl {
  const lines = content.trimEnd().split(/\r?\n/)
  const persistedResourcePaths: string[] = []
  const output = lines.map((line) => {
    const value = rewriteStorageReferences(JSON.parse(line) as unknown, context, persistedResourcePaths)
    if (!isRecord(value)) throw new Error('Claude Session JSONL entry must be an object')
    if (value.sessionId === context.sourceSessionId) value.sessionId = context.targetSessionId
    if (value.session_id === context.sourceSessionId) value.session_id = context.targetSessionId
    if (typeof value.cwd === 'string' && context.sourceCwd !== context.targetCwd) {
      value.cwd = rewriteCwd(value.cwd, context.sourceCwd, context.targetCwd)
    }
    return JSON.stringify(value)
  })
  return { content: `${output.join('\n')}\n`, lineCount: lines.length, persistedResourcePaths }
}

function rewriteStorageReferences(
  value: unknown,
  context: { sourceResources: string; targetResources: string },
  persistedResourcePaths: string[],
  key?: string,
): unknown {
  if (typeof value === 'string') {
    if (key === 'persistedOutputPath' && value.startsWith(context.sourceResources)) {
      persistedResourcePaths.push(value)
    }
    return value.replaceAll(context.sourceResources, context.targetResources)
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteStorageReferences(item, context, persistedResourcePaths))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      rewriteStorageReferences(entryValue, context, persistedResourcePaths, entryKey),
    ]),
  )
}

async function rewriteCompanionJsonl(
  directory: string,
  context: Parameters<typeof rewriteJsonl>[1],
): Promise<string[]> {
  const persistedResourcePaths: string[] = []
  for (const file of await listFiles(directory)) {
    if (!file.endsWith('.jsonl')) continue
    const rewritten = rewriteJsonl(await readFile(file, 'utf8'), context)
    persistedResourcePaths.push(...rewritten.persistedResourcePaths)
    await writeFile(file, rewritten.content, 'utf8')
  }
  return persistedResourcePaths
}

async function materializePersistedResources(
  paths: string[],
  context: {
    sourceSessionId: string
    targetSessionId: string
    sourceResources: string
    temporaryResources: string
  },
): Promise<void> {
  for (const sourcePath of new Set(paths)) {
    const pathFromResources = relative(context.sourceResources, sourcePath)
    if (pathFromResources.startsWith(`..${sep}`) || pathFromResources === '..' || isAbsolute(pathFromResources)) {
      throw new Error(`Persisted output escapes the source Session directory: ${sourcePath}`)
    }
    const temporaryPath = resolveWithin(context.temporaryResources, pathFromResources)
    if (await pathExists(temporaryPath)) continue
    await mkdir(dirname(temporaryPath), { recursive: true })
    await writeFile(temporaryPath, MISSING_OUTPUT_PLACEHOLDER, { encoding: 'utf8', flag: 'wx' })
    log.warn({
      sourceSessionId: context.sourceSessionId,
      targetSessionId: context.targetSessionId,
      sourcePath,
      targetPath: temporaryPath,
    }, 'Claude persisted tool output missing; placeholder created')
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function countFiles(directory: string): Promise<number> {
  return (await listFiles(directory)).length
}

function rewriteCwd(value: string, sourceCwd: string, targetCwd: string): string {
  if (value === sourceCwd) return targetCwd
  const prefix = sourceCwd.endsWith(sep) ? sourceCwd : `${sourceCwd}${sep}`
  return value.startsWith(prefix) ? join(targetCwd, value.slice(prefix.length)) : value
}

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error(`Claude Session ID must be a valid UUID: ${sessionId}`)
}

function validateCwd(cwd: string): void {
  if (!isAbsolute(cwd)) throw new Error(`Claude Session cwd must be absolute: ${cwd}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}
