import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import type { FileContent } from '../../stores/filesystem.store'
import { FilePreview } from '../../components/file-viewer/FilePreview'

interface WorkspaceCenterStageProps {
  chat: ReactNode
  file: FileContent | null
  fileMode: boolean
  onCloseFile: () => void
  projectId: string | null
}

export function WorkspaceCenterStage({
  chat,
  file,
  fileMode,
  onCloseFile,
  projectId,
}: WorkspaceCenterStageProps) {
  return (
    <>
      {fileMode && (
        <main
          data-workspace-pane="file"
          style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-0)' }}
        >
          {file ? (
            <FilePreview file={file} projectId={projectId} onClose={onCloseFile} />
          ) : (
            <div
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}
            >
              <div style={{ textAlign: 'center' }}>
                <FileText size={32} style={{ opacity: 0.28, marginBottom: 10 }} />
                <div style={{ fontSize: 14 }}>从左侧选择文件</div>
              </div>
            </div>
          )}
        </main>
      )}
      <main
        data-workspace-pane="chat"
        aria-hidden={fileMode || undefined}
        style={{ flex: 1, display: fileMode ? 'none' : 'flex', flexDirection: 'column', minWidth: 0 }}
      >
        {chat}
      </main>
    </>
  )
}
