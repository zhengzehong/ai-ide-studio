import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Bot, ChevronDown, CircleAlert, Delete, Loader2, MessageSquare, Plus, RefreshCw, Sparkles } from 'lucide-react'
import type { InspirationCandidate, InspirationNote } from '@desktop/stores/inspiration.store'
import { useAppStore } from '../stores/app.store'
import { useInspirationStore } from '../stores/inspiration.store'
import { inspirationStatusMeta, isNoteCompleted } from '../utils/inspiration-status'
import { formatRelativeTime } from '../utils/task-time'
import { showToast } from '../utils/toast'
import ConfirmDialog from '../components/ConfirmDialog'
import CandidateTaskSheet from '../components/CandidateTaskSheet'
import MarkdownView from '../components/MarkdownView'

export default function InspirationDetailPage() {
  const { noteId = '' } = useParams<{ noteId: string }>()
  const navigate = useNavigate()
  const currentProjectId = useAppStore((state) => state.currentProjectId)
  const byProject = useInspirationStore((state) => state.byProject)
  const loadError = useInspirationStore((state) => state.error)
  const load = useInspirationStore((state) => state.load)
  const organize = useInspirationStore((state) => state.organize)
  const setCompleted = useInspirationStore((state) => state.setCompleted)
  const removeNote = useInspirationStore((state) => state.removeNote)
  const createCandidateTask = useInspirationStore((state) => state.createCandidateTask)

  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [taskCandidate, setTaskCandidate] = useState<InspirationCandidate | null>(null)
  // 候选任务说明默认折叠,点标题展开(一次只展开一条)
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null)

  const note = useMemo<InspirationNote | null>(() => {
    for (const entry of Object.values(byProject)) {
      const found = entry.notes.find((item) => item.id === noteId)
      if (found) return found
    }
    return null
  }, [byProject, noteId])

  const projectId = note?.projectId ?? currentProjectId
  const loaded = Boolean(projectId && byProject[projectId]?.loaded)

  useEffect(() => {
    if (note || !projectId) return
    void load(projectId, { silent: true })
  }, [note, projectId, load])

  const handleOrganize = useCallback(async () => {
    if (!projectId || !note) return
    setBusy(true)
    try {
      await organize(projectId, note.id)
      showToast('已开始整理')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '整理失败')
    } finally {
      setBusy(false)
    }
  }, [projectId, note, organize])

  const handleToggleCompleted = useCallback(async () => {
    if (!projectId || !note) return
    const next = !isNoteCompleted(note)
    setBusy(true)
    try {
      await setCompleted(projectId, note.id, next)
      showToast(next ? '已完成' : '已重新打开')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }, [projectId, note, setCompleted])

  const handleDelete = useCallback(async () => {
    if (!projectId || !note) return
    setBusy(true)
    try {
      await removeNote(projectId, note.id)
      showToast('已删除')
      navigate('/inspiration', { replace: true })
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败')
      setBusy(false)
    }
  }, [projectId, note, removeNote, navigate])

  const handleCreateTask = useCallback(async (agentId: string, sessionId: string, execute: boolean) => {
    if (!projectId || !taskCandidate) return
    setBusy(true)
    try {
      await createCandidateTask(projectId, taskCandidate.id, agentId, sessionId, execute)
      showToast(execute ? '任务已创建并开始执行' : '任务已创建,可在任务页启动')
      setTaskCandidate(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建任务失败')
    } finally {
      setBusy(false)
    }
  }, [projectId, taskCandidate, createCandidateTask])

  const handleOpenSession = useCallback(() => {
    const sessionId = projectId ? byProject[projectId]?.config?.sessionId : null
    if (!sessionId) {
      showToast('先到 PC 端配置灵感助手')
      return
    }
    navigate(`/chat/${sessionId}`)
  }, [projectId, byProject, navigate])

  if (!note && loaded) {
    return (
      <div style={styles.page}>
        <DetailHeader onBack={() => navigate('/inspiration', { replace: true })} title="灵感详情" />
        <div style={styles.missing}>
          <CircleAlert size={36} color="var(--text-muted)" strokeWidth={1.4} />
          <span style={styles.missingText}>灵感不存在或已被删除</span>
        </div>
      </div>
    )
  }

  if (!note) {
    // 拿不到归属项目(如 web 端直接刷新详情 URL)或加载失败时给出明确提示,避免永远转圈
    return (
      <div style={styles.page}>
        <DetailHeader onBack={() => navigate(-1)} title="灵感详情" />
        <div style={styles.missing}>
          {loadError ? (
            <>
              <CircleAlert size={36} color="var(--error)" strokeWidth={1.4} />
              <span style={{ ...styles.missingText, color: 'var(--error)' }}>{loadError}</span>
              {projectId && (
                <button
                  className="pressable"
                  style={styles.retryBtn}
                  onClick={() => void load(projectId, { silent: false })}
                >
                  重试
                </button>
              )}
            </>
          ) : projectId ? (
            <Loader2 size={24} color="var(--text-muted)" className="spin" />
          ) : (
            <>
              <CircleAlert size={36} color="var(--text-muted)" strokeWidth={1.4} />
              <span style={styles.missingText}>未找到灵感,请先选择项目</span>
            </>
          )}
        </div>
      </div>
    )
  }

  const status = inspirationStatusMeta(note.status)
  const completed = isNoteCompleted(note)
  const organizing = note.status === 'queued' || note.status === 'processing'
  const failed = note.status === 'failed'
  const hasResult = Boolean(note.summary || note.bodyMarkdown)
  const organizerSessionId = projectId ? byProject[projectId]?.config?.sessionId ?? null : null
  const inspirationConfig = projectId ? byProject[projectId]?.config ?? null : null

  return (
    <div style={styles.page}>
      <DetailHeader
        onBack={() => navigate('/inspiration', { replace: true })}
        title={note.title || '灵感详情'}
        action={
          <button className="pressable" style={styles.sessionBtn} onClick={handleOpenSession} aria-label="灵感会话">
            <MessageSquare size={19} color={organizerSessionId ? 'var(--primary)' : 'var(--text-muted)'} />
          </button>
        }
      />

      <div style={styles.body}>
        {organizing && (
          <div style={styles.processingCard}>
            <Loader2 size={18} color="var(--primary)" className="spin" />
            <div>
              <div style={styles.processingTitle}>AI 正在整理{note.status === 'queued' ? '(排队中)' : ''}...</div>
              <div style={styles.processingText}>整理完成后会自动更新,可以先看看原文。</div>
            </div>
          </div>
        )}

        {failed && (
          <div style={styles.failedCard}>
            <div style={styles.failedTitle}>整理失败</div>
            {note.lastError && <div style={styles.failedText}>{note.lastError}</div>}
            <div style={styles.failedText}>原文还在,点下方「重新整理」再试一次。</div>
          </div>
        )}

        {note.status === 'draft' && (
          <div style={styles.draftCard}>
            <Sparkles size={18} color="var(--primary)" />
            <div>
              <div style={styles.processingTitle}>这条还没整理</div>
              <div style={styles.processingText}>点下方「整理一下」,AI 会帮你拆解成方案和待办。</div>
            </div>
          </div>
        )}

        <div className="card" style={styles.sourceCard}>
          <div style={styles.sectionLabel}>原文</div>
          <div style={styles.sourceText}>{note.sourceMarkdown}</div>
          <div style={styles.sourceMeta}>
            记录于 {formatRelativeTime(note.createdAt)}
            {note.completedAt ? ` · ${formatRelativeTime(note.completedAt)}标记完成` : ''}
          </div>
        </div>

        {hasResult && (
          <div className="card" style={styles.resultCard}>
            <div style={styles.sectionLabelRow}>
              <Bot size={15} color="var(--primary)" />
              <span style={styles.sectionLabel}>AI 整理</span>
              <span style={{ ...styles.statusChip, color: status.color }}>{status.label}</span>
            </div>
            {note.summary && <div style={styles.summaryBlock}>{note.summary}</div>}
            {note.bodyMarkdown && <MarkdownView content={note.bodyMarkdown} />}
            {note.questions.length > 0 && (
              <div style={styles.questions}>
                <div style={styles.questionsTitle}>待确认问题</div>
                {note.questions.map((question, index) => (
                  <div key={index} style={styles.questionItem}>
                    <span style={styles.questionIndex}>{index + 1}</span>
                    <span style={styles.questionText}>{question}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {note.candidates.length > 0 && (
          <div style={styles.candidatesSection}>
            <div style={styles.sectionLabel}>候选任务({note.candidates.length})</div>
            <div style={styles.candidatesHint}>AI 拆好的可执行任务,点标题展开详情、一键创建</div>
            {note.candidates.map((candidate) => {
              const expanded = expandedCandidateId === candidate.id
              const expandable = Boolean(candidate.descriptionMarkdown)
              return (
                <div key={candidate.id} className="card" style={styles.candidateCard}>
                  <button
                    className="pressable"
                    style={styles.candidateHead}
                    disabled={!expandable}
                    onClick={() => setExpandedCandidateId(expanded ? null : candidate.id)}
                  >
                    {expandable && (
                      <ChevronDown
                        size={15}
                        color="var(--text-muted)"
                        style={{ ...styles.candidateChevron, ...(expanded ? styles.candidateChevronOpen : {}) }}
                      />
                    )}
                    <span style={styles.candidateTitle}>{candidate.title}</span>
                  </button>
                  {expanded && candidate.descriptionMarkdown && (
                    <MarkdownView content={candidate.descriptionMarkdown} compact />
                  )}
                  <div style={styles.candidateFoot}>
                    {candidate.suggestedAgentName && (
                      <span style={styles.agentChip}>{candidate.suggestedAgentName}</span>
                    )}
                    {candidate.taskId && <span style={styles.createdChip}>已创建任务</span>}
                    <button
                      className="pressable"
                      style={{
                        ...styles.candidateAction,
                        ...(candidate.taskId ? styles.candidateViewBtn : styles.candidateCreateBtn),
                      }}
                      disabled={busy}
                      onClick={() =>
                        candidate.taskId ? navigate(`/task/${candidate.taskId}`) : setTaskCandidate(candidate)
                      }
                    >
                      {candidate.taskId ? (
                        '查看任务'
                      ) : (
                        <>
                          <Plus size={13} color="var(--primary)" />
                          创建任务
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          className="pressable"
          style={styles.deleteBtn}
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <Delete size={17} color="var(--error)" />
          <span>删除</span>
        </button>
        {organizing ? (
          <button className="pressable" style={{ ...styles.mainBtn, ...styles.mainBtnDisabled }} disabled>
            整理中...
          </button>
        ) : (
          <>
            {hasResult && (
              <button
                className="pressable"
                style={styles.secondaryBtn}
                disabled={busy}
                onClick={() => void handleOrganize()}
              >
                <RefreshCw size={15} color="var(--text-primary)" />
                <span>重新整理</span>
              </button>
            )}
            <button
              className="pressable"
              style={{ ...styles.mainBtn, ...(note.status === 'draft' || failed ? {} : styles.mainBtnSecondary) }}
              disabled={busy}
              onClick={() => void (note.status === 'draft' || failed ? handleOrganize() : handleToggleCompleted())}
            >
              {note.status === 'draft' || failed ? '整理一下' : completed ? '重新打开' : '标记完成'}
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="删除灵感"
        message={`确定要删除「${note.title || '未命名灵感'}」吗?整理结果和候选任务会一起删除,此操作不可恢复。`}
        confirmText="删除"
        danger
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />

      <CandidateTaskSheet
        open={!!taskCandidate}
        candidate={taskCandidate}
        projectId={projectId}
        config={inspirationConfig}
        busy={busy}
        onClose={() => setTaskCandidate(null)}
        onConfirm={(agentId, sessionId, execute) => void handleCreateTask(agentId, sessionId, execute)}
      />
    </div>
  )
}

function DetailHeader({ onBack, title, action }: { onBack: () => void; title: string; action?: ReactNode }) {
  return (
    <div style={styles.header}>
      <button className="pressable" style={styles.backBtn} onClick={onBack} aria-label="返回">
        <ArrowLeft size={22} color="var(--text-primary)" />
      </button>
      <span style={styles.headerTitle}>{title}</span>
      {action ?? <span style={styles.headerSpacer} />}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--bg)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    paddingTop: 'calc(10px + var(--safe-top))',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  backBtn: {
    width: 38,
    height: 38,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  headerSpacer: {
    width: 38,
    flexShrink: 0,
  },
  sessionBtn: {
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-input)',
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px 16px calc(16px + var(--safe-bottom))',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  missing: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  missingText: {
    fontSize: 14,
    color: 'var(--text-muted)',
  },
  retryBtn: {
    marginTop: 14,
    padding: '8px 22px',
    borderRadius: 18,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
  },
  processingCard: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: 'var(--radius)',
    background: 'var(--primary-bg)',
  },
  processingTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  processingText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
  },
  failedCard: {
    padding: '12px 14px',
    borderRadius: 'var(--radius)',
    background: 'var(--error-bg)',
  },
  failedTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--error)',
  },
  failedText: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--error)',
    wordBreak: 'break-word',
  },
  draftCard: {
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
    padding: '12px 14px',
    borderRadius: 'var(--radius)',
    background: 'var(--primary-bg)',
  },
  sourceCard: {
    padding: '13px 14px',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    letterSpacing: 1,
  },
  sectionLabelRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  statusChip: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: 600,
  },
  sourceText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 1.7,
    color: 'var(--text-primary)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  sourceMeta: {
    marginTop: 10,
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  resultCard: {
    padding: '13px 14px',
  },
  summaryBlock: {
    marginTop: 9,
    padding: '9px 11px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--primary-bg)',
    fontSize: 13,
    lineHeight: 1.6,
    color: 'var(--text-primary)',
    borderLeft: '3px solid var(--primary)',
  },
  questions: {
    marginTop: 14,
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--warning-bg)',
  },
  questionsTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--warning)',
  },
  questionItem: {
    display: 'flex',
    gap: 8,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  questionIndex: {
    width: 16,
    height: 16,
    borderRadius: 8,
    background: 'var(--warning)',
    color: '#fff',
    fontSize: 10,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  questionText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  },
  candidatesSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  candidatesHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    marginTop: -4,
  },
  candidateCard: {
    padding: '12px 14px',
  },
  candidateHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: 0,
    textAlign: 'left',
  },
  candidateChevron: {
    flexShrink: 0,
    transition: 'transform .15s',
  },
  candidateChevronOpen: {
    transform: 'rotate(180deg)',
  },
  candidateTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  candidateFoot: {
    marginTop: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  candidateAction: {
    marginLeft: 'auto',
    minHeight: 30,
    padding: '0 12px',
    borderRadius: 15,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  },
  candidateCreateBtn: {
    background: 'var(--primary-bg)',
    color: 'var(--primary)',
  },
  candidateViewBtn: {
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
  },
  agentChip: {
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--info-bg)',
    color: 'var(--info)',
    fontSize: 11,
    fontWeight: 600,
  },
  createdChip: {
    padding: '2px 8px',
    borderRadius: 10,
    background: 'var(--success-bg)',
    color: 'var(--success)',
    fontSize: 11,
    fontWeight: 600,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    padding: '10px 16px calc(10px + var(--safe-bottom))',
    background: 'var(--bg-card)',
    borderTop: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  deleteBtn: {
    height: 42,
    padding: '0 16px',
    borderRadius: 21,
    background: 'var(--bg-input)',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 14,
    color: 'var(--error)',
    flexShrink: 0,
  },
  secondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    background: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: 14,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  mainBtn: {
    flex: 1,
    height: 42,
    borderRadius: 21,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
  },
  mainBtnSecondary: {
    background: 'var(--primary-bg)',
    color: 'var(--primary)',
  },
  mainBtnDisabled: {
    background: 'var(--border)',
    color: 'var(--text-muted)',
  },
}
