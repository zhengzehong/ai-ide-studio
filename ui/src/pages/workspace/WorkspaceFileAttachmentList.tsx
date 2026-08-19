import { FileText, Loader2, X } from 'lucide-react'
import {
  formatWorkspaceFileSize,
  type WorkspacePendingFile,
} from './workspace-file-attachments'

export function WorkspaceFileAttachmentList({
  files,
  onRemove,
}: {
  files: WorkspacePendingFile[]
  onRemove: (localId: string) => void
}) {
  if (files.length === 0) return null
  return (
    <div className="workspace-file-attachments" aria-label="待发送文件">
      {files.map((file) => (
        <div
          key={file.localId}
          className={`workspace-file-attachment${file.status === 'error' ? ' workspace-file-attachment--error' : ''}`}
        >
          {file.status === 'uploading'
            ? <Loader2 size={15} className="workspace-file-attachment-spinner" />
            : <FileText size={15} />}
          <span className="workspace-file-attachment-name" title={file.name}>{file.name}</span>
          <span className="workspace-file-attachment-meta">
            {file.status === 'uploading'
              ? '上传中'
              : file.status === 'error'
                ? file.error
                : formatWorkspaceFileSize(file.size)}
          </span>
          <button type="button" onClick={() => onRemove(file.localId)} title="移除文件" aria-label={`移除 ${file.name}`}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
