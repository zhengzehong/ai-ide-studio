import { useState } from 'react';
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from 'lucide-react';
import type { FileEntry } from '../../stores/filesystem.store';

const EXT_COLORS: Record<string, string> = {
  '.ts': '#3178c6', '.tsx': '#3178c6', '.js': '#f7df1e', '.jsx': '#f7df1e',
  '.json': '#6d6d6d', '.md': '#083fa1', '.css': '#264de4', '.html': '#e44d26',
  '.py': '#3776ab', '.rs': '#dea584', '.go': '#00add8', '.sql': '#e38c00',
  '.yaml': '#cb171e', '.yml': '#cb171e', '.sh': '#4eaa25',
};

export function FileTree({ entries, onSelectFile, onExpandDir, selectedPath }: {
  entries: FileEntry[];
  onSelectFile: (path: string) => void;
  onExpandDir: (path: string) => void;
  selectedPath: string | null;
}) {
  return (
    <div style={{ fontSize: 15, userSelect: 'none' }}>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          onSelectFile={onSelectFile}
          onExpandDir={onExpandDir}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

function FileTreeNode({ entry, depth, onSelectFile, onExpandDir, selectedPath }: {
  entry: FileEntry;
  depth: number;
  onSelectFile: (path: string) => void;
  onExpandDir: (path: string) => void;
  selectedPath: string | null;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = entry.type === 'directory';
  const isSelected = entry.path === selectedPath;

  const handleClick = () => {
    if (isDir) {
      const willExpand = !expanded;
      setExpanded(willExpand);
      if (willExpand && (!entry.children || entry.children.length === 0)) {
        onExpandDir(entry.path);
      }
    } else {
      onSelectFile(entry.path);
    }
  };

  const extColor = !isDir && entry.extension ? EXT_COLORS[entry.extension] : undefined;

  return (
    <>
      <div
        onClick={handleClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px 3px', paddingLeft: 8 + depth * 16,
          cursor: 'pointer', borderRadius: 4,
          background: isSelected ? 'var(--blue-light)' : 'transparent',
          color: isSelected ? 'var(--blue)' : 'var(--text-2)',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget.style.background = 'var(--bg-2)'); }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget.style.background = 'transparent'); }}
      >
        {isDir ? (
          expanded ? <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        {isDir ? (
          expanded ? <FolderOpen size={15} style={{ color: 'var(--blue)', flexShrink: 0 }} /> : <Folder size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        ) : (
          <File size={14} style={{ color: extColor || 'var(--text-3)', flexShrink: 0 }} />
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </span>
      </div>
      {isDir && expanded && entry.children && entry.children.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          onSelectFile={onSelectFile}
          onExpandDir={onExpandDir}
          selectedPath={selectedPath}
        />
      ))}
    </>
  );
}
