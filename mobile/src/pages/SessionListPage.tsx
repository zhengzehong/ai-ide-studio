import { MessageSquarePlus } from 'lucide-react'
import SessionGroup from '../components/SessionGroup'
import ProjectDrawer from '../components/ProjectDrawer'
import ActionSheet from '../components/ActionSheet'
import { AgentProfileSheet } from '../components/settings/ModelProfileSheets'
import { PinnedSessionList } from './PinnedSessionsPage'
import { SessionListTopbar } from '../components/session-list/SessionListTopbar'
import { SessionListOverlays } from '../components/session-list/SessionListOverlays'
import { sessionListStyles as styles } from './session-list-styles'
import { projectTeamPins } from '../utils/team-list-projections'
import { useSessionListPage } from './use-session-list-page'
import { useConversationCatalog } from '../stores/conversation-catalog.store'

export default function SessionListPage() {
  const { setDrawerOpen, containerRef, viewMode, edgeSwipe, sortedProjects, currentProjectId, drawerOpen, isDrawerPinned, handlePickProject, handleTogglePin, handleCloseDrawer, setCreateSheetOpen, handleManageProjects, drawerRef, overlayRef, projectUnread, totalSessions, currentProject, pinnedItems, catalog, handleOpenDrawer, handleNewSession, loadPinned, handleToggleMode, catalogError, showEmpty, catalogLoaded, agentGroups, owners, handleLongPress, handleHeaderLongPress, createSheetOpen, actionSession, actionItems, renameTarget, deleteTarget, newSessionOpen, publishSession, handleCreatedProject, setActionSession, handleRenameConfirm, setRenameTarget, handleDeleteConfirm, setDeleteTarget, setNewSessionOpen, handleNewBlankFromSheet, handleNewFromTemplateSheet, setPublishSession, agentSheetOpen, profileAgent, profileAgentSheetItems, setAgentSheetOpen, profileSheetOpen, setProfileSheetOpen } = useSessionListPage()

  return (
    <div
      ref={containerRef}
      style={styles.page}
      onPointerDown={viewMode === 'all' ? edgeSwipe.onPointerDown : undefined}
    >
      {viewMode === 'all' && (
        <>
          <ProjectDrawer
            projects={sortedProjects}
            currentProjectId={currentProjectId}
            isOpen={drawerOpen}
            isPinned={isDrawerPinned}
            onPickProject={handlePickProject}
            onTogglePin={handleTogglePin}
            onClose={handleCloseDrawer}
            onCreateProject={() => {
              if (!isDrawerPinned) setDrawerOpen(false)
              setCreateSheetOpen(true)
            }}
            onManageProjects={handleManageProjects}
            drawerRef={drawerRef}
            overlayRef={overlayRef}
            projectUnread={projectUnread}
            totalSessions={totalSessions}
          />
        </>
      )}

      <div
        style={{
          ...styles.mainArea,
          ...(viewMode === 'all' && isDrawerPinned ? styles.mainAreaPinned : {}),
        }}
      >
        <SessionListTopbar
          mode={viewMode}
          project={currentProject}
          pinnedCount={projectTeamPins(pinnedItems, catalog).length}
          isDrawerPinned={isDrawerPinned}
          onOpenDrawer={handleOpenDrawer}
          onNewSession={handleNewSession}
          onRefreshPinned={() => { void loadPinned(); void useConversationCatalog.getState().load() }}
          onToggleMode={handleToggleMode}
        />

        {viewMode === 'pinned' ? <PinnedSessionList /> : (
          <div style={styles.list}>
            {catalogError && <button onClick={() => { void useConversationCatalog.getState().load() }} style={{ color: 'var(--error)', padding: 12 }}>{catalogError} · 重试</button>}
            {!catalogLoaded && !catalogError && <div role="status" style={styles.empty}>加载会话…</div>}
            {showEmpty && (
              <div style={styles.empty}>
                <MessageSquarePlus size={40} color="var(--text-muted)" strokeWidth={1.2} />
                <span style={styles.emptyText}>暂无会话</span>
              </div>
            )}
            {catalogLoaded && agentGroups.map((group) => (
              <SessionGroup
                key={group.agentId}
                agentId={group.agentId}
                agentName={group.agentName}
                team={owners.find(owner => owner.id === group.agentId)?.kind === 'team'}
                sessions={group.sessions}
                onLongPress={handleLongPress}
                onHeaderLongPress={owners.find(owner => owner.id === group.agentId)?.kind === 'team' ? undefined : () => handleHeaderLongPress(group.agentId)}
              />
            ))}
          </div>
        )}
      </div>

      <SessionListOverlays
        currentProjectId={currentProjectId}
        createSheetOpen={createSheetOpen}
        actionSession={actionSession}
        actionItems={actionItems}
        renameTarget={renameTarget}
        deleteTarget={deleteTarget}
        newSessionOpen={newSessionOpen}
        publishSession={publishSession}
        onCloseCreate={() => setCreateSheetOpen(false)}
        onCreatedProject={handleCreatedProject}
        onCloseAction={() => setActionSession(null)}
        onRenameConfirm={handleRenameConfirm}
        onCloseRename={() => setRenameTarget(null)}
        onDeleteConfirm={handleDeleteConfirm}
        onCloseDelete={() => setDeleteTarget(null)}
        onCloseNewSession={() => setNewSessionOpen(false)}
        onNewBlank={handleNewBlankFromSheet}
        onInstantiated={handleNewFromTemplateSheet}
        onClosePublish={() => setPublishSession(null)}
      />

      <ActionSheet
        open={agentSheetOpen}
        title={profileAgent?.name ?? 'Agent'}
        items={profileAgentSheetItems}
        onClose={() => setAgentSheetOpen(false)}
      />
      <AgentProfileSheet
        agent={profileSheetOpen ? profileAgent : null}
        onClose={() => setProfileSheetOpen(false)}
      />
    </div>
  )
}
