export const MAX_WORKSPACE_FILES = 10

export interface WorkspaceUploadedFile {
  id: string
  name: string
  mimeType: string
  size: number
  path: string
  relativePath: string
}

export type WorkspacePendingFile = {
  localId: string
  name: string
  size: number
  status: 'uploading'
} | {
  localId: string
  name: string
  size: number
  status: 'uploaded'
  uploaded: WorkspaceUploadedFile
} | {
  localId: string
  name: string
  size: number
  status: 'error'
  error: string
}

export function partitionWorkspaceFiles(files: File[]): { images: File[]; files: File[] } {
  const images: File[] = []
  const regularFiles: File[] = []
  for (const file of files) {
    if (file.type.startsWith('image/')) images.push(file)
    else regularFiles.push(file)
  }
  return { images, files: regularFiles }
}

export function appendWorkspaceFilePaths(content: string, files: WorkspaceUploadedFile[]): string {
  if (files.length === 0) return content
  const lines = [
    content,
    content ? '' : undefined,
    '[文件附件]',
    '以下文件已上传到服务端，请根据需要通过对应路径读取。',
  ].filter((line): line is string => line !== undefined)
  files.forEach((file, index) => {
    lines.push(
      `附件 ${index + 1}:`,
      `- 文件路径: ${file.path}`,
      `- MIME: ${file.mimeType}`,
      `- 原始文件名: ${file.name}`,
    )
  })
  return lines.join('\n')
}

export function formatWorkspaceFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
