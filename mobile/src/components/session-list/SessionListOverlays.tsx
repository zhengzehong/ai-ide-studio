import type { ComponentProps } from 'react'
import type { MobileSessionItem } from '../../stores/session.store'
import ActionSheet from '../ActionSheet'
import ConfirmDialog from '../ConfirmDialog'
import RenameDialog from '../RenameDialog'
import ProjectCreateSheet from '../ProjectCreateSheet'
import NewSessionSheet from '../chat/NewSessionSheet'
import PublishTemplateSheet from '../templates/PublishTemplateSheet'

interface Props {
  currentProjectId: string | null
  createSheetOpen: boolean
  actionSession: MobileSessionItem | null
  actionItems: ComponentProps<typeof ActionSheet>['items']
  renameTarget: MobileSessionItem | null
  deleteTarget: MobileSessionItem | null
  newSessionOpen: boolean
  publishSession: MobileSessionItem | null
  onCloseCreate: () => void
  onCreatedProject: (projectId: string) => void
  onCloseAction: () => void
  onRenameConfirm: (title: string) => void
  onCloseRename: () => void
  onDeleteConfirm: () => void
  onCloseDelete: () => void
  onCloseNewSession: () => void
  onNewBlank: (agentId: string) => void
  onInstantiated: (sessionId: string) => void
  onClosePublish: () => void
}

export function SessionListOverlays(props: Props) {
  return (
    <>
      <ProjectCreateSheet open={props.createSheetOpen} onClose={props.onCloseCreate} onCreated={props.onCreatedProject} />
      <ActionSheet
        open={!!props.actionSession}
        title={props.actionSession?.sessionTitle || props.actionSession?.agentName || '会话操作'}
        items={props.actionItems}
        onClose={props.onCloseAction}
      />
      <RenameDialog
        open={!!props.renameTarget}
        initialTitle={props.renameTarget?.sessionTitle || props.renameTarget?.agentName || ''}
        onConfirm={props.onRenameConfirm}
        onCancel={props.onCloseRename}
      />
      <ConfirmDialog
        open={!!props.deleteTarget}
        title="删除会话"
        message="删除后不可恢复,确定要删除该会话吗?"
        confirmText="删除"
        danger
        onConfirm={props.onDeleteConfirm}
        onCancel={props.onCloseDelete}
      />
      {props.currentProjectId && (
        <NewSessionSheet
          open={props.newSessionOpen}
          projectId={props.currentProjectId}
          onClose={props.onCloseNewSession}
          onNewBlank={props.onNewBlank}
          onInstantiated={props.onInstantiated}
        />
      )}
      {props.publishSession && (
        <PublishTemplateSheet open sessionId={props.publishSession.id} onClose={props.onClosePublish} onPublished={() => undefined} />
      )}
    </>
  )
}
