import { useState, type CSSProperties } from 'react'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Loader2 } from 'lucide-react'
import type { FileEntry } from '../../stores/filesystem.store'

const EXT_COLORS: Record<string, string> = {
  '.ts': '#3178c6', '.tsx': '#3178c6', '.js': '#f7df1e', '.jsx': '#f7df1e',
  '.json': '#6d6d6d', '.md': '#083fa1', '.mdx': '#083fa1', '.css': '#264de4',
  '.html': '#e44d26', '.py': '#3776ab', '.rs': '#dea584', '.go': '#00add8',
  '.sql': '#e38c00', '.yaml': '#cb171e', '.yml': '#cb171e', '.sh': '#4eaa25',
  '.vue': '#42b883', '.svelte': '#ff3e00',
}

interface FileTreeProps {
  entries: FileEntry[]
  selectedPath: string | null
  loadingDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

export function FileTree({ entries, selectedPath, loadingDirs, onSelectFile, onToggleDir }: FileTreeProps) {
  return (
    <div style={styles.container}>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          loadingDirs={loadingDirs}
          onSelectFile={onSelectFile}
          onToggleDir={onToggleDir}
        />
      ))}
    </div>
  )
}

interface NodeProps {
  entry: FileEntry
  depth: number
  selectedPath: string | null
  loadingDirs: Set<string>
  onSelectFile: (path: string) => void
  onToggleDir: (path: string) => void
}

function FileTreeNode({ entry, depth, selectedPath, loadingDirs, onSelectFile, onToggleDir }: NodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isDir = entry.type === 'directory'
  const isSelected = entry.path === selectedPath
  const isLoading = loadingDirs.has(entry.path)
  const hasChildrenLoaded = entry.children !== undefined
  const isEmpty = hasChildrenLoaded && entry.children!.length === 0

  const handleClick = () => {
    if (isDir) {
      const willExpand = !expanded
      setExpanded(willExpand)
      if (willExpand && !hasChildrenLoaded) {
        onToggleDir(entry.path)
      }
    } else {
      onSelectFile(entry.path)
    }
  }

  const extColor = !isDir && entry.extension ? EXT_COLORS[entry.extension] : undefined

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          ...styles.row,
          paddingLeft: 8 + depth * 16,
          background: isSelected ? 'var(--primary-bg)' : 'transparent',
          color: isSelected ? 'var(--primary)' : 'var(--text-primary)',
        }}
      >
        {isDir ? (
          isLoading ? (
            <Loader2 size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
          ) : expanded ? (
            <ChevronDown size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          ) : (
            <ChevronRight size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          )
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          ) : (
            <Folder size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          )
        ) : (
          <File size={14} style={{ color: extColor || 'var(--text-muted)', flexShrink: 0 }} />
        )}
        <span style={styles.name}>{entry.name}</span>
        {isDir && isEmpty && (
          <span style={styles.emptyHint}>空</span>
        )}
      </div>
      {isDir && expanded && entry.children && entry.children.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          loadingDirs={loadingDirs}
          onSelectFile={onSelectFile}
          onToggleDir={onToggleDir}
        />
      ))}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    fontSize: 14,
    userSelect: 'none',
    paddingBottom: 20,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 8px',
    paddingRight: 12,
    cursor: 'pointer',
    minHeight: 32,
  },
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emptyHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
}
