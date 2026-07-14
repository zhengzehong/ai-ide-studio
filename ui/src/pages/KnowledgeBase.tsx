import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database } from 'lucide-react'
import { useAgentStore } from '../stores/agent.store'
import { useKnowledgeBaseStore } from '../stores/knowledge-base.store'
import { useProjectStore } from '../stores/project.store'
import { useSessionStore } from '../stores/session.store'
import { KnowledgeActivityPanel } from './knowledge-base/KnowledgeActivityPanel'
import { KnowledgeDocument } from './knowledge-base/KnowledgeDocument'
import { CreateKnowledgeBaseModal, CreatePageModal, RefreshAgentModal } from './knowledge-base/KnowledgeModals'
import { KnowledgeSidebar } from './knowledge-base/KnowledgeSidebar'
import { PageTree } from './knowledge-base/PageTree'
import { formFromPage, formSrcFiles, formTags, type PageFormState } from './knowledge-base/page-form'
import './knowledge-base/knowledge-base.css'

const EMPTY_FORM: PageFormState = { title: '', section: '', summary: '', body: '', tags: '', srcFiles: '' }

export default function KnowledgeBase() {
  const navigate = useNavigate()
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const agents = useAgentStore((state) => state.agents)
  const createSession = useSessionStore((state) => state.createSession)
  const selectSession = useSessionStore((state) => state.selectSession)
  const sendPrompt = useSessionStore((state) => state.sendPrompt)

  const knowledgeBases = useKnowledgeBaseStore((state) => state.knowledgeBases)
  const sharedKnowledgeBases = useKnowledgeBaseStore((state) => state.sharedKnowledgeBases)
  const pagesByKbId = useKnowledgeBaseStore((state) => state.pagesByKbId)
  const currentKbId = useKnowledgeBaseStore((state) => state.currentKbId)
  const currentPageId = useKnowledgeBaseStore((state) => state.currentPageId)
  const currentRead = useKnowledgeBaseStore((state) => state.currentRead)
  const activities = useKnowledgeBaseStore((state) => state.activities)
  const searchResults = useKnowledgeBaseStore((state) => state.searchResults)
  const loading = useKnowledgeBaseStore((state) => state.loading)
  const pageLoading = useKnowledgeBaseStore((state) => state.pageLoading)
  const saving = useKnowledgeBaseStore((state) => state.saving)
  const error = useKnowledgeBaseStore((state) => state.error)
  const isDirty = useKnowledgeBaseStore((state) => state.isDirty)
  const remoteUpdatePending = useKnowledgeBaseStore((state) => state.remoteUpdatePending)
  const setDirty = useKnowledgeBaseStore((state) => state.setDirty)
  const clearError = useKnowledgeBaseStore((state) => state.clearError)
  const fetchKnowledgeBases = useKnowledgeBaseStore((state) => state.fetchKnowledgeBases)
  const fetchSharedKnowledgeBases = useKnowledgeBaseStore((state) => state.fetchSharedKnowledgeBases)
  const selectKnowledgeBase = useKnowledgeBaseStore((state) => state.selectKnowledgeBase)
  const readPage = useKnowledgeBaseStore((state) => state.readPage)
  const searchPages = useKnowledgeBaseStore((state) => state.searchPages)
  const createKnowledgeBase = useKnowledgeBaseStore((state) => state.createKnowledgeBase)
  const mountKnowledgeBase = useKnowledgeBaseStore((state) => state.mountKnowledgeBase)
  const unmountKnowledgeBase = useKnowledgeBaseStore((state) => state.unmountKnowledgeBase)
  const createPage = useKnowledgeBaseStore((state) => state.createPage)
  const updatePage = useKnowledgeBaseStore((state) => state.updatePage)
  const revertActivity = useKnowledgeBaseStore((state) => state.revertActivity)

  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PageFormState>(EMPTY_FORM)
  const [query, setQuery] = useState('')
  const [showCreateKb, setShowCreateKb] = useState(false)
  const [showCreatePage, setShowCreatePage] = useState(false)
  const [showRefreshAgent, setShowRefreshAgent] = useState(false)
  const [createPageInitial, setCreatePageInitial] = useState<PageFormState>(EMPTY_FORM)
  const [formPageId, setFormPageId] = useState<string | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  const currentKb = useMemo(
    () => knowledgeBases.find((kb) => kb.id === currentKbId) ?? null,
    [knowledgeBases, currentKbId],
  )
  const currentPages = currentKbId ? pagesByKbId[currentKbId] ?? [] : []
  const projectAgents = agents.filter((agent) => !currentProjectId || agent.project_id === currentProjectId)

  useEffect(() => {
    if (!currentProjectId) return
    void fetchKnowledgeBases(currentProjectId)
    void fetchSharedKnowledgeBases()
  }, [currentProjectId, fetchKnowledgeBases, fetchSharedKnowledgeBases])

  useEffect(() => {
    if (!currentProjectId) return
    const timer = setTimeout(() => {
      void searchPages(currentProjectId, query, currentKbId ? [currentKbId] : undefined)
    }, 250)
    return () => clearTimeout(timer)
  }, [currentProjectId, currentKbId, query, searchPages])

  const activePageId = currentRead?.page.id ?? null
  const editingCurrentPage = editing && formPageId === activePageId
  const documentForm = editingCurrentPage ? form : formFromPage(currentRead?.page)
  const visibleError = operationError ?? error
  if (!currentProjectId) {
    return (
      <div className="kb-project-empty">
        <Database size={32} />
        <h1>请选择项目</h1>
        <p>知识库按项目提供给 AI，先选择一个项目后再进入 LLM Wiki。</p>
      </div>
    )
  }

  const handleSave = async () => {
    if (!currentRead || !currentProjectId) return
    setOperationError(null)
    try {
      await updatePage(currentProjectId, {
        pageId: currentRead.page.id,
        title: form.title,
        section: form.section || null,
        summary: form.summary || null,
        body: form.body,
        tags: formTags(form),
      })
      setEditing(false)
      setFormPageId(null)
      setDirty(false)
    } catch (err) {
      setOperationError(`保存失败，草稿仍保留：${errorMessage(err)}`)
    }
  }

  const handleCreatePage = async (next: PageFormState) => {
    if (!currentProjectId || !currentKbId) return
    setOperationError(null)
    try {
      await createPage(currentProjectId, {
        kbId: currentKbId,
        title: next.title,
        section: next.section || undefined,
        summary: next.summary || undefined,
        body: next.body,
        tags: formTags(next),
        srcFiles: formSrcFiles(next),
      })
      setShowCreatePage(false)
      setCreatePageInitial(EMPTY_FORM)
    } catch (err) {
      setOperationError(`新建页面失败：${errorMessage(err)}`)
    }
  }

  const handleRefreshWithAgent = async (agentId: string) => {
    if (!currentProjectId || !currentRead) return
    setOperationError(null)
    try {
      const sourceFiles = formSrcFiles(formFromPage(currentRead.page))
      const session = await createSession(agentId, undefined, currentProjectId)
      selectSession(session.id)
      sendPrompt(buildRefreshPrompt(currentRead.page.id, currentRead.page.title, currentRead.kb.id, sourceFiles))
      setShowRefreshAgent(false)
      navigate('/workspace')
    } catch (err) {
      setOperationError(`启动 AI 刷新失败：${errorMessage(err)}`)
    }
  }

  return (
    <div className="kb-page">
      <KnowledgeSidebar
        knowledgeBases={knowledgeBases}
        sharedKnowledgeBases={sharedKnowledgeBases}
        currentKbId={currentKbId}
        onSelect={(kbId) => void selectKnowledgeBase(currentProjectId, kbId)}
        onCreate={() => setShowCreateKb(true)}
        onMount={(kbId) => void mountKnowledgeBase(currentProjectId, kbId)}
        onUnmount={(kbId) => {
          if (window.confirm('卸载后当前项目的 Agent 将看不到这个共享库，确定继续？')) {
            void unmountKnowledgeBase(currentProjectId, kbId)
          }
        }}
      />

      <PageTree
        pages={currentPages}
        searchResults={searchResults}
        currentPageId={currentPageId}
        searchQuery={query}
        onSearchChange={setQuery}
        onSelect={(pageId) => void readPage(currentProjectId, { pageId })}
        onCreate={() => {
          setCreatePageInitial(EMPTY_FORM)
          setShowCreatePage(true)
        }}
      />

      <KnowledgeDocument
        read={currentRead}
        pageLoading={loading || pageLoading}
        saving={saving}
        editing={editingCurrentPage}
        form={documentForm}
        onEdit={() => {
          setForm(formFromPage(currentRead?.page))
          setFormPageId(activePageId)
          setEditing(true)
          setDirty(false)
        }}
        onCancel={() => {
          setForm(formFromPage(currentRead?.page))
          setFormPageId(null)
          setEditing(false)
          setDirty(false)
        }}
        onFormChange={(patch) => {
          setForm((prev) => ({ ...prev, ...patch }))
          setDirty(true)
        }}
        onSave={() => void handleSave()}
        onWikiLink={(link) => {
          if (link.status === 'resolved' && link.pageId) {
            void readPage(currentProjectId, { pageId: link.pageId })
            return
          }
          if (link.status === 'missing' && link.kbId) {
            setCreatePageInitial({ ...EMPTY_FORM, title: link.title, body: `# ${link.title}\n\n` })
            setShowCreatePage(true)
            return
          }
          window.alert('这个链接需要先用 [[库名/标题]] 消歧，或挂载对应知识库。')
        }}
        onBacklink={(link) => void readPage(currentProjectId, { pageId: link.pageId })}
        onRefreshByAgent={() => setShowRefreshAgent(true)}
      />

      <KnowledgeActivityPanel
        activities={activities}
        pages={currentPages}
        onRevert={(activityId) => {
          if (window.confirm('撤销会按活动顺序回到该次写入前的状态，不做多版本合并。确定撤销？')) {
            void revertActivity(currentProjectId, activityId)
          }
        }}
      />

      {visibleError && (
        <div className="kb-error">
          <span>{visibleError}</span>
          <button
            type="button"
            aria-label="关闭错误提示"
            onClick={() => {
              setOperationError(null)
              clearError()
            }}
          >
            ×
          </button>
        </div>
      )}

      {remoteUpdatePending && editingCurrentPage && (
        <div className="kb-error" style={{ background: 'var(--warn-bg, #fff8e1)', borderColor: 'var(--warn, #f5a623)', color: 'var(--warn, #b86d00)' }}>
          <span>此页面有新版本（他人已保存更新）。为避免覆盖，编辑内容已保留为草稿；如需拉取最新版本，请先取消编辑再重新进入。</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => useKnowledgeBaseStore.setState({ remoteUpdatePending: false })}
          >
            ×
          </button>
        </div>
      )}

      {showCreateKb && (
        <CreateKnowledgeBaseModal
          onClose={() => setShowCreateKb(false)}
          onSubmit={(input) => {
            setOperationError(null)
            void createKnowledgeBase(currentProjectId, input)
              .then(() => setShowCreateKb(false))
              .catch((err: unknown) => setOperationError(`新建知识库失败：${errorMessage(err)}`))
          }}
        />
      )}
      {showCreatePage && (
        <CreatePageModal
          initial={createPageInitial}
          codeSource={currentKb?.src === 'code'}
          onClose={() => setShowCreatePage(false)}
          onSubmit={(next) => void handleCreatePage(next)}
        />
      )}
      {showRefreshAgent && (
        <RefreshAgentModal
          agents={projectAgents}
          onClose={() => setShowRefreshAgent(false)}
          onSubmit={(agentId) => void handleRefreshWithAgent(agentId)}
        />
      )}
    </div>
  )
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function buildRefreshPrompt(pageId: string, title: string, kbId: string, srcFiles: string[]): string {
  return [
    `请刷新知识库代码页「${title}」。`,
    `页面 ID: ${pageId}`,
    `知识库 ID: ${kbId}`,
    srcFiles.length ? `源文件:\n${srcFiles.map((file) => `- ${file}`).join('\n')}` : '源文件记录为空，请先读取页面详情确认 src_files。',
    '要求：先读取当前源文件内容，形成更新后的 markdown 正文，然后调用 core.kb.refresh_from_code。',
    '不要直接猜测代码内容；如果源文件无法读取，请说明失败原因。',
  ].join('\n\n')
}
