import type { ImageAttachmentInfo } from '../../stores/session-events'
import type { WorkspacePendingFile } from '../../pages/workspace/workspace-file-attachments'

export function canSendConversation(
  sessionId: string | null,
  sending: boolean,
  value: string,
  files: WorkspacePendingFile[],
  images: ImageAttachmentInfo[],
): boolean {
  return !!sessionId
    && !sending
    && !files.some((file) => file.status === 'uploading')
    && (!!value.trim() || files.some((file) => file.status === 'uploaded') || images.length > 0)
}
