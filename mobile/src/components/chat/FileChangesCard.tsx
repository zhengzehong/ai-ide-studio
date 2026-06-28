import { useState, useMemo, type CSSProperties } from 'react'
import { FileCode, ChevronDown, ChevronRight, Plus, Minus, FilePlus, FileX, FilePen } from 'lucide-react'
import type { TurnProcessBlock } from '@desktop/stores/turn-blocks'

interface FileEntry {
  path: string
  changeType: 'A' | 'M' | 'D' | '?'
  addedLines: number
  deletedLines: number
}

export function extractFileChangesFromBlocks(blocks: TurnProcessBlock[]): FileEntry[] {
  const files: FileEntry[] = []
  for (const block of blocks) {
    if (block.kind === 'tool') {
      const tc = block.toolCall
      if (tc.content) {
        for (const item of tc.content) {
          if (item.path && (item.type === 'write' || item.type === 'edit' || item.type === 'create' || item.type === 'str_replace')) {
            const existing = files.find(f => f.path === item.path)
            if (!existing) {
              files.push({
                path: item.path,
                changeType: item.type === 'create' ? 'A' : 'M',
                addedLines: (item.newText?.split('\n').length ?? 0),
                deletedLines: (item.oldText?.split('\n').length ?? 0),
              })
            }
          }
        }
      }
    }
    if (block.kind === 'file_change' && block.changes) {
      for (const f of block.changes.files) {
        if (!files.find(e => e.path === f.path)) {
          files.push(f)
        }
      }
    }
  }
  return files
}

const typeIcon = { A: FilePlus, M: FilePen, D: FileX, '?': FileCode }
const typeColor = { A: 'var(--success)', M: 'var(--info)', D: 'var(--error)', '?': 'var(--text-muted)' }

export default function FileChangesCard({ files }: { files: FileEntry[] }) {
  const [expanded, setExpanded] = useState(false)

  const stats = useMemo(() => {
    let added = 0, deleted = 0
    files.forEach(f => { added += f.addedLines; deleted += f.deletedLines })
    return { added, deleted }
  }, [files])

  if (files.length === 0) return null

  return (
    <div style={styles.card}>
      <button style={styles.header} onClick={() => setExpanded(!expanded)}>
        <FileCode size={14} color="var(--warning)" />
        <span style={styles.title}>{files.length} 个文件变更</span>
        <span style={styles.stat}>
          <Plus size={11} color="var(--success)" />{stats.added}
          <Minus size={11} color="var(--error)" style={{ marginLeft: 6 }} />{stats.deleted}
        </span>
        {expanded ? <ChevronDown size={14} color="var(--text-muted)" /> : <ChevronRight size={14} color="var(--text-muted)" />}
      </button>
      {expanded && (
        <div style={styles.list}>
          {files.map((f, i) => {
            const Icon = typeIcon[f.changeType] || FileCode
            const color = typeColor[f.changeType] || 'var(--text-muted)'
            return (
              <div key={i} style={styles.fileRow}>
                <Icon size={13} color={color} style={{ flexShrink: 0 }} />
                <span style={styles.filePath}>{f.path.split('/').pop()}</span>
                <span style={styles.fileStat}>
                  {f.addedLines > 0 && <span style={{ color: 'var(--success)' }}>+{f.addedLines}</span>}
                  {f.deletedLines > 0 && <span style={{ color: 'var(--error)', marginLeft: 4 }}>-{f.deletedLines}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    margin: '8px 0 4px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
    background: '#fffbf0',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    width: '100%',
    textAlign: 'left',
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  stat: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 11,
    color: 'var(--text-secondary)',
    fontFamily: 'monospace',
  },
  list: {
    borderTop: '1px solid var(--border-light)',
    padding: '4px 10px',
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
  },
  filePath: {
    flex: 1,
    fontSize: 12,
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fileStat: {
    fontSize: 11,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
}
