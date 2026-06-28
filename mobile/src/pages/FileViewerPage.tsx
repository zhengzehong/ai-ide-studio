import { useEffect, useState, useRef, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Folder, AlertCircle, Loader2 } from 'lucide-react'
import { useFileSystemStore } from '../stores/filesystem.store'
import { FileTree } from '../components/file-viewer/FileTree'
import { FileDetail } from '../components/file-viewer/FileDetail'

interface LocationState {
  projectId?: string | null
  sessionId?: string
}

export default function FileViewerPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state || {}) as LocationState
  const projectId = state.projectId

  const {
    tree, openFile, loading, loadingFile, error,
    initTree, expandDir, openFileByPath, closeFile, reset,
  } = useFileSystemStore()

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const listScrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)

  useEffect(() => {
    if (!projectId) return
    initTree(projectId)
  }, [projectId, initTree])

  useEffect(() => {
    return () => {
      reset()
    }
  }, [reset])

  const handleToggleDir = async (dirPath: string) => {
    setLoadingDirs((prev) => new Set(prev).add(dirPath))
    try {
      await expandDir(dirPath)
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    }
  }

  const handleSelectFile = (filePath: string) => {
    savedScroll.current = listScrollRef.current?.scrollTop ?? 0
    setSelectedPath(filePath)
    openFileByPath(filePath)
  }

  const handleBackToList = () => {
    closeFile()
    setSelectedPath(null)
    requestAnimationFrame(() => {
      if (listScrollRef.current) listScrollRef.current.scrollTop = savedScroll.current
    })
  }

  if (!projectId) {
    return (
      <div style={styles.errorPage}>
        <AlertCircle size={40} color="var(--text-muted)" />
        <span style={styles.errorText}>当前会话未绑定项目,无法查看文件</span>
        <button style={styles.backBtn} onClick={() => navigate(-1)}>返回</button>
      </div>
    )
  }

  const showDetail = !!openFile || loadingFile || !!error

  return (
    <div style={styles.page}>
      <div style={{
        ...styles.listPane,
        transform: showDetail ? 'translateX(-30%)' : 'translateX(0)',
        opacity: showDetail ? 0.5 : 1,
      }}>
        <div style={styles.header}>
          <button style={styles.iconBtn} onClick={() => navigate(-1)} aria-label="返回">
            <ArrowLeft size={20} />
          </button>
          <Folder size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <span style={styles.headerTitle}>文件</span>
        </div>

        <div ref={listScrollRef} style={styles.listBody}>
          {loading ? (
            <div style={styles.centerState}>
              <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--text-muted)' }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>加载目录...</span>
            </div>
          ) : tree.length === 0 ? (
            <div style={styles.centerState}>
              <Folder size={40} color="var(--text-muted)" style={{ opacity: 0.4 }} />
              <span style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                {error || '目录为空或无权限访问'}
              </span>
            </div>
          ) : (
            <FileTree
              entries={tree}
              selectedPath={selectedPath}
              loadingDirs={loadingDirs}
              onSelectFile={handleSelectFile}
              onToggleDir={handleToggleDir}
            />
          )}
        </div>
      </div>

      {showDetail && (
        <div style={styles.detailPane}>
          <FileDetail
            file={openFile || PLACEHOLDER_FILE}
            loading={loadingFile}
            error={error}
            onBack={handleBackToList}
          />
        </div>
      )}
    </div>
  )
}

const PLACEHOLDER_FILE = {
  path: '',
  content: '',
  size: 0,
  extension: '',
  language: '',
  truncated: false,
  kind: 'text' as const,
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    position: 'relative',
    height: '100%',
    background: 'var(--bg)',
    overflow: 'hidden',
  },
  listPane: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    transition: 'transform 0.25s ease, opacity 0.25s ease',
    flexShrink: 0,
  },
  detailPane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'var(--bg-card)',
    animation: 'slideInRight 0.25s ease',
    zIndex: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  iconBtn: {
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  listBody: {
    flex: 1,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    padding: '4px 0',
  },
  centerState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 60,
  },
  errorPage: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    height: '100%',
    padding: 40,
    background: 'var(--bg)',
  },
  errorText: {
    fontSize: 14,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },
  backBtn: {
    marginTop: 12,
    padding: '8px 20px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
}
