import { Lightbulb, MessageSquare, Pencil, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectNavigation } from '../hooks/use-project-navigation'
import { useProjectScopeId } from '../hooks/use-project-scope'
import { useAgentStore } from '../stores/agent.store'
import { useInspirationStore, type InspirationCandidate } from '../stores/inspiration.store'
import { useProjectViewStateStore } from '../stores/project-view-state.store'
import { CandidateTaskDialog, type CandidateAction } from './inspiration/CandidateTaskDialog'
import { InspirationEditor } from './inspiration/InspirationEditor'
import { InspirationList } from './inspiration/InspirationList'
import { InspirationResult } from './inspiration/InspirationResult'
import { InspirationSettingsDialog } from './inspiration/InspirationSettingsDialog'
import './inspiration/inspiration.css'

type ViewMode = 'result' | 'edit'

export function Inspiration() {
  const projectId = useProjectScopeId()
  const navigate = useNavigate()
  const { toProjectPath } = useProjectNavigation()
  const allAgents = useAgentStore((state) => state.agents)
  const agents = useMemo(
    () => allAgents.filter((agent) => agent.project_id === projectId && !agent.hidden_at),
    [allAgents, projectId],
  )
  const fetchAgents = useAgentStore((state) => state.fetchAgents)
  const inspirationProjectId = useInspirationStore((state) => state.projectId)
  const config = useInspirationStore((state) => state.config)
  const notes = useInspirationStore((state) => state.notes)
  const selectedId = useInspirationStore((state) => state.selectedId)
  const loading = useInspirationStore((state) => state.loading)
  const saving = useInspirationStore((state) => state.saving)
  const error = useInspirationStore((state) => state.error)
  const load = useInspirationStore((state) => state.load)
  const select = useInspirationStore((state) => state.select)
  const saveInspirationNote = useInspirationStore((state) => state.saveNote)
  const removeNote = useInspirationStore((state) => state.removeNote)
  const organize = useInspirationStore((state) => state.organize)
  const configure = useInspirationStore((state) => state.configure)
  const rebuildSession = useInspirationStore((state) => state.rebuildSession)
  const updateCandidate = useInspirationStore((state) => state.updateCandidate)
  const createCandidateTask = useInspirationStore((state) => state.createCandidateTask)
  const setupListeners = useInspirationStore((state) => state.setupListeners)
  const patchTasks = useProjectViewStateStore((state) => state.patchTasks)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<ViewMode>('result')
  const [editorVersion, setEditorVersion] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [candidateDialog, setCandidateDialog] = useState<{ candidate: InspirationCandidate; action: CandidateAction } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const selected = useMemo(() => notes.find((note) => note.id === selectedId) ?? null, [notes, selectedId])
  const showEditor = mode === 'edit' || (!loading && inspirationProjectId === projectId && notes.length === 0)

  useEffect(() => { void load(projectId); void fetchAgents(projectId) }, [fetchAgents, load, projectId])
  useEffect(() => setupListeners(), [setupListeners])

  const selectResult = (noteId: string): void => { select(noteId); setMode('result'); setNotice(null) }
  const editNote = (noteId: string): void => { select(noteId); setMode('edit'); setEditorVersion((value) => value + 1); setNotice(null) }
  const createNote = (): void => { select(null); setMode('edit'); setEditorVersion((value) => value + 1); setNotice(null) }

  const saveNote = async (input: { title: string; titleMode: 'auto' | 'manual'; sourceMarkdown: string; keepAttachmentPaths: string[]; images: Array<{ data: string; mimeType: string; name?: string }> }): Promise<void> => {
    try {
      const note = await saveInspirationNote({ noteId: selected?.id, ...input })
      setMode('result')
      setNotice(note.status === 'draft' ? '原文已保存，请配置整理 Agent' : '原文已保存，AI 正在后台整理')
      if (!config?.organizerAgentId) setSettingsOpen(true)
    } catch (error) {
      setNotice(errorMessage(error, '灵感保存失败'))
    }
  }

  const confirmCandidate = async (input: { title: string; descriptionMarkdown: string; agentId: string; action: CandidateAction }): Promise<void> => {
    if (!candidateDialog) return
    setActionBusy(true)
    try {
      await updateCandidate(candidateDialog.candidate.id, {
        title: input.title,
        descriptionMarkdown: input.descriptionMarkdown,
        suggestedAgentId: input.agentId || null,
      })
      if (input.action !== 'edit') {
        await createCandidateTask(candidateDialog.candidate.id, input.agentId, input.action === 'execute')
      }
      setNotice(input.action === 'execute' ? '任务已创建并派发' : input.action === 'create' ? '任务已创建，尚未执行' : '候选任务已更新')
      setCandidateDialog(null)
    } catch (error) {
      setNotice(errorMessage(error, '候选任务处理失败'))
    } finally {
      setActionBusy(false)
    }
  }

  const openTask = (taskId: string): void => {
    patchTasks(projectId, { selectedTaskId: taskId })
    navigate(toProjectPath('/tasks'))
  }

  const openSession = (sessionId: string, inspirationNoteId?: string): void => {
    navigate(`${toProjectPath('/workspace')}?${new URLSearchParams({ sessionId, ...(inspirationNoteId ? { inspirationNoteId } : {}) }).toString()}`)
  }

  const activeDiscussionNoteId = selected && mode === 'result' ? selected.id : undefined

  const deleteSelected = async (): Promise<void> => {
    if (!selected || !window.confirm(`确定删除灵感“${selected.title}”？`)) return
    try {
      await removeNote(selected.id)
      setMode(notes.length <= 1 ? 'edit' : 'result')
    } catch (error) {
      setNotice(errorMessage(error, '灵感删除失败'))
    }
  }

  return (
    <div className="inspiration-page">
      <header className="inspiration-page-header">
        <div className="inspiration-heading"><span><Lightbulb size={18} /></span><div><h1>灵感</h1><p>记录想法，由项目长期会话整理为方案和候选任务。</p></div></div>
        <div className="inspiration-header-actions">
          {notice && <span className="inspiration-notice">{notice}</span>}
          <button type="button" className="inspiration-icon-button" onClick={() => void load(projectId)} title="刷新" aria-label="刷新"><RefreshCw size={15} /></button>
          <button type="button" className="inspiration-secondary" disabled={!config?.sessionId} onClick={() => config?.sessionId && openSession(config.sessionId, activeDiscussionNoteId)}><MessageSquare size={14} />{activeDiscussionNoteId ? '讨论当前灵感' : '灵感会话'}</button>
          <button type="button" className="inspiration-secondary" onClick={() => setSettingsOpen(true)}><Settings2 size={14} />设置</button>
          {selected && mode === 'result' && <button type="button" className="inspiration-secondary" onClick={() => editNote(selected.id)}><Pencil size={14} />编辑原文</button>}
          {selected && <button type="button" className="inspiration-icon-button danger" onClick={() => void deleteSelected()} title="删除灵感" aria-label="删除灵感"><Trash2 size={15} /></button>}
        </div>
      </header>
      {error && <div className="inspiration-error">{error}</div>}
      <main className="inspiration-workbench">
        <InspirationList notes={notes} selectedId={selectedId} query={query} onQueryChange={setQuery} onSelect={selectResult} onEdit={editNote} onCreate={createNote} />
        <section className="inspiration-detail-pane">
          {loading ? <div className="inspiration-result-state"><RefreshCw size={20} className="inspiration-spin" /><strong>正在加载灵感</strong></div> : showEditor ? (
            <InspirationEditor key={`${selected?.id ?? 'new'}-${editorVersion}`} note={selected} saving={saving} onSave={saveNote} />
          ) : selected ? (
            <InspirationResult note={selected} onEdit={() => editNote(selected.id)} onRetry={() => { void organize(selected.id).catch((error) => setNotice(errorMessage(error, '重新整理失败'))) }} onCandidateAction={(candidate, action) => setCandidateDialog({ candidate, action })} onOpenTask={openTask} onOpenSession={openSession} onDiscuss={() => config?.sessionId && openSession(config.sessionId, selected.id)} />
          ) : <div className="inspiration-result-state"><Lightbulb size={22} /><strong>记录第一条灵感</strong><span>原文会立即保存，AI 整理在后台完成。</span><button type="button" className="inspiration-primary" onClick={createNote}>开始记录</button></div>}
        </section>
      </main>
      {settingsOpen && config && <InspirationSettingsDialog config={config} agents={agents} saving={saving} onClose={() => setSettingsOpen(false)} onRebuild={rebuildSession} onSave={async (input) => { await configure(input); setSettingsOpen(false); if (selected?.status === 'draft') await organize(selected.id); setNotice('项目灵感设置已保存') }} />}
      {candidateDialog && <CandidateTaskDialog candidate={candidateDialog.candidate} action={candidateDialog.action} agents={agents} busy={actionBusy} onClose={() => setCandidateDialog(null)} onConfirm={confirmCandidate} />}
    </div>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
