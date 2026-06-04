import type { FileChangeDetailData, FileChangeLineData, FileChangeSummaryData, ToolCallData } from '../types/ws-protocol.js'

interface DiffSegment {
  toolCallId: string
  path: string
  oldText?: string
  newText: string
}

export function buildFileChangesFromToolCalls(toolCalls: ToolCallData[]): FileChangeDetailData {
  const filesByPath = new Map<string, FileChangeDetailData['files'][number]>()

  for (const segment of diffSegments(toolCalls)) {
    const lines = buildDiffLines(segment.oldText, segment.newText)
    const addedLines = lines.filter((line) => line.type === 'add').length
    const deletedLines = lines.filter((line) => line.type === 'del').length
    const changeType = inferChangeType(segment.oldText, segment.newText)
    const existing = filesByPath.get(segment.path)

    if (existing) {
      existing.addedLines += addedLines
      existing.deletedLines += deletedLines
      existing.changeType = mergeChangeType(existing.changeType, changeType)
      existing.segments.push({
        toolCallId: segment.toolCallId,
        oldText: segment.oldText,
        newText: segment.newText,
        addedLines,
        deletedLines,
        lines,
      })
      continue
    }

    filesByPath.set(segment.path, {
      path: segment.path,
      changeType,
      addedLines,
      deletedLines,
      segments: [{
        toolCallId: segment.toolCallId,
        oldText: segment.oldText,
        newText: segment.newText,
        addedLines,
        deletedLines,
        lines,
      }],
    })
  }

  const files = Array.from(filesByPath.values())
  return {
    files,
    totalAdded: files.reduce((sum, file) => sum + file.addedLines, 0),
    totalDeleted: files.reduce((sum, file) => sum + file.deletedLines, 0),
  }
}

export function summarizeFileChanges(changes: FileChangeDetailData): FileChangeSummaryData | undefined {
  if (changes.files.length === 0) return undefined
  return {
    files: changes.files.map((file) => ({
      path: file.path,
      changeType: file.changeType,
      addedLines: file.addedLines,
      deletedLines: file.deletedLines,
    })),
    totalAdded: changes.totalAdded,
    totalDeleted: changes.totalDeleted,
  }
}

export function fileChangesJsonFromToolCalls(toolCalls: unknown[] | undefined): string | null {
  if (!toolCalls) return null
  const changes = summarizeFileChanges(buildFileChangesFromToolCalls(toolCalls.filter(isToolCallData)))
  return changes ? JSON.stringify(changes) : null
}

export function parseFileChangesJson(raw: string | null): FileChangeSummaryData | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return isFileChangeSummary(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function diffSegments(toolCalls: ToolCallData[]): DiffSegment[] {
  const segments: DiffSegment[] = []
  for (const tool of toolCalls) {
    for (const item of tool.content ?? []) {
      if (item.type !== 'diff' || !item.path || typeof item.newText !== 'string') continue
      segments.push({
        toolCallId: tool.id,
        path: item.path,
        oldText: typeof item.oldText === 'string' ? item.oldText : undefined,
        newText: item.newText,
      })
    }
  }
  return segments
}

function inferChangeType(oldText: string | undefined, newText: string): 'A' | 'M' | 'D' | '?' {
  if (oldText === undefined && newText.length > 0) return 'A'
  if (oldText !== undefined && newText.length === 0) return 'D'
  if (oldText !== undefined) return 'M'
  return '?'
}

function mergeChangeType(current: 'A' | 'M' | 'D' | '?', next: 'A' | 'M' | 'D' | '?'): 'A' | 'M' | 'D' | '?' {
  if (current === next) return current
  if (current === 'A' && next === 'M') return 'A'
  if (current === '?' || next === '?') return '?'
  return 'M'
}

function buildDiffLines(oldText: string | undefined, newText: string): FileChangeLineData[] {
  if (oldText === undefined) {
    return splitLines(newText).map((text, index) => ({ type: 'add', text, newLine: index + 1 }))
  }

  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const table = buildLcsTable(oldLines, newLines)
  const lines: FileChangeLineData[] = []
  let oldIndex = 0
  let newIndex = 0

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      lines.push({ type: 'ctx', text: oldLines[oldIndex], oldLine: oldIndex + 1, newLine: newIndex + 1 })
      oldIndex += 1
      newIndex += 1
      continue
    }

    if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
      lines.push({ type: 'add', text: newLines[newIndex], newLine: newIndex + 1 })
      newIndex += 1
      continue
    }

    if (oldIndex < oldLines.length) {
      lines.push({ type: 'del', text: oldLines[oldIndex], oldLine: oldIndex + 1 })
      oldIndex += 1
    }
  }

  return lines
}

function splitLines(text: string): string[] {
  if (!text) return []
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text
  return normalized ? normalized.split('\n') : []
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  return table
}

function isToolCallData(value: unknown): value is ToolCallData {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'
}

function isFileChangeSummary(value: unknown): value is FileChangeSummaryData {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.files)
}
