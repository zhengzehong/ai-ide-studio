import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { wsClient } from '@desktop/services/ws-client'
import type { InspirationNote } from '@desktop/stores/inspiration.store'
import { Check, ChevronUp, Lightbulb, ListTodo, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { useAppStore, type ProjectItem } from '../stores/app.store'
import { useInspirationStore } from '../stores/inspiration.store'
import { isNoteCompleted, inspirationStatusMeta, noteExcerpt } from '../utils/inspiration-status'
import { formatRelativeTime } from '../utils/task-time'
import { showToast } from '../utils/toast'
import { sortProjectsByCreation } from './session-list-model'

type NoteFilter = 'all' | 'active' | 'done'

const FILTERS: { key: NoteFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
]

const EMPTY_TEXT: Record<NoteFilter, string> = {
  all: '还没有灵感记录',
  active: '暂无进行中的灵感',
  done: '暂无已完成的灵感',
}

function resolveIcon(project: ProjectItem | undefined): string {
  if (!project) return '🌐'
  return project.icon || '📦'
}

function resolveColor(project: ProjectItem | undefined): string {
  if (!project) return 'var(--primary)'
  return project.color || 'var(--primary)'
}

function matchesFilter(note: InspirationNote, filter: NoteFilter): boolean {
  if (filter === 'done') return isNoteCompleted(note)
  if (filter === 'active') return !isNoteCompleted(note)
  return true
}

/** 卡片时间口径:整理过看整理时间,否则看更新时间 */
function noteTime(note: InspirationNote): string {
  return formatRelativeTime(note.organizedAt || note.updatedAt || note.createdAt)
}

export default function InspirationPage() {
  const navigate = useNavigate()
  const projects = useAppStore((state) => state.projects)
  const currentProjectId = useAppStore((state) => state.currentProjectId)
  const setCurrentProject = useAppStore((state) => state.setCurrentProject)
  const byProject = useInspirationStore((state) => state.byProject)
  const loading = useInspirationStore((state) => state.loading)
  const error = useInspirationStore((state) => state.error)
  const load = useInspirationStore((state) => state.load)

  const [filter, setFilter] = useState<NoteFilter>('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [needsInputCount, setNeedsInputCount] = useState(0)

  const listRef = useRef<HTMLDivElement | null>(null)
  const touchRef = useRef<{ x: number; y: number; ptrArmed: boolean } | null>(null)
  const taskCountTimerRef = useRef<number | null>(null)

  const project = useMemo(
    () => projects.find((item) => item.id === currentProjectId),
    [projects, currentProjectId],
  )
  const sortedProjects = useMemo(() => sortProjectsByCreation(projects), [projects])
  const entry = currentProjectId ? byProject[currentProjectId] : undefined
  const notes = entry?.notes ?? []

  useEffect(() => {
    if (!currentProjectId) return
    // 已缓存的项目静默刷新,未缓存的才转圈;getState 取缓存状态,避免把 byProject 挂进依赖造成循环触发
    const cached = useInspirationStore.getState().byProject[currentProjectId]?.loaded
    void load(currentProjectId, { silent: Boolean(cached) })
  }, [currentProjectId, load])

  // 「待确认」任务角标:轻入口的核心是别让任务闭环断掉,数量要跟得上 task:update
  const fetchNeedsInputCount = useCallback(async () => {
    try {
      const request: Record<string, unknown> = { type: 'tasks.list' }
      if (currentProjectId) request.projectId = currentProjectId
      const data = (await wsClient.request(request)) as { status?: string }[]
      setNeedsInputCount(data.filter((task) => task.status === 'needs_input').length)
    } catch {
      /* ignore */
    }
  }, [currentProjectId])

  useEffect(() => {
    void fetchNeedsInputCount()
    const off = wsClient.on('task:update', () => {
      // task:update 在执行期高频触发,合并成一次兜底刷新
      if (taskCountTimerRef.current !== null) return
      taskCountTimerRef.current = window.setTimeout(() => {
        taskCountTimerRef.current = null
        void fetchNeedsInputCount()
      }, 400)
    })
    return () => {
      off()
      if (taskCountTimerRef.current !== null) {
        window.clearTimeout(taskCountTimerRef.current)
        taskCountTimerRef.current = null
      }
    }
  }, [fetchNeedsInputCount])

  const counts = useMemo(
    () => ({
      all: notes.length,
      active: notes.filter((note) => !isNoteCompleted(note)).length,
      done: notes.filter((note) => isNoteCompleted(note)).length,
    }),
    [notes],
  )

  const visibleNotes = useMemo(
    () => notes.filter((note) => matchesFilter(note, filter)),
    [notes, filter],
  )

  const switchProject = useCallback(
    (direction: 1 | -1) => {
      if (sortedProjects.length === 0) return
      const index = sortedProjects.findIndex((item) => item.id === currentProjectId)
      const nextIndex = index < 0 ? 0 : (index + direction + sortedProjects.length) % sortedProjects.length
      setCurrentProject(sortedProjects[nextIndex].id)
    },
    [sortedProjects, currentProjectId, setCurrentProject],
  )

  const handleRefresh = useCallback(async () => {
    if (!currentProjectId || refreshing) return
    setRefreshing(true)
    try {
      await load(currentProjectId, { silent: true })
    } finally {
      setRefreshing(false)
    }
  }, [currentProjectId, refreshing, load])

  // 手势互斥:横滑切项目(横向位移 > 纵向 1.8 倍) / 列表顶部下拉刷新
  const handleTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      ptrArmed: (listRef.current?.scrollTop ?? 0) <= 0,
    }
  }, [])

  const handleTouchEnd = useCallback(
    (event: TouchEvent<HTMLDivElement>) => {
      const start = touchRef.current
      touchRef.current = null
      if (!start) return
      const touch = event.changedTouches[0]
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        switchProject(dx < 0 ? 1 : -1)
        return
      }
      if (start.ptrArmed && dy > 70 && Math.abs(dx) < 40) {
        void handleRefresh()
      }
    },
    [switchProject, handleRefresh],
  )

  const handleAdd = useCallback(() => {
    if (!currentProjectId) {
      showToast('请先选择项目')
      setSheetOpen(true)
      return
    }
    navigate('/inspiration/new')
  }, [currentProjectId, navigate])

  const unconfigured = Boolean(entry?.loaded && !entry?.config?.organizerAgentId)

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <Lightbulb size={20} color="var(--primary)" />
          <span style={styles.headerTitle}>灵感</span>
        </div>
        <button
          className="pressable"
          style={styles.tasksBtn}
          onClick={() => navigate('/tasks')}
          aria-label="任务列表"
        >
          <ListTodo size={20} color="var(--text-secondary)" />
          {needsInputCount > 0 && (
            <span style={styles.tasksBadge}>{needsInputCount > 9 ? '9+' : needsInputCount}</span>
          )}
        </button>
      </div>

      <div style={styles.filterBar}>
        {FILTERS.map((item) => {
          const active = item.key === filter
          return (
            <button
              key={item.key}
              className="pressable"
              style={{ ...styles.chip, ...(active ? styles.chipActive : {}) }}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              <span style={{ ...styles.chipCount, ...(active ? styles.chipCountActive : {}) }}>{counts[item.key]}</span>
            </button>
          )
        })}
      </div>

      <div
        ref={listRef}
        style={styles.list}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {refreshing && (
          <div style={styles.ptrRow}>
            <RefreshCw size={14} color="var(--primary)" className="spin" />
            <span>刷新中...</span>
          </div>
        )}

        {!currentProjectId && (
          <div style={styles.empty}>
            <Lightbulb size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={styles.emptyText}>先选择一个项目,再开始记录灵感</span>
            <button className="pressable" style={styles.emptyAction} onClick={() => setSheetOpen(true)}>
              选择项目
            </button>
          </div>
        )}

        {currentProjectId && loading && !entry?.loaded && <div style={styles.empty}>加载中...</div>}

        {currentProjectId && error && !entry?.loaded && (
          <div style={styles.empty}>
            <span style={{ ...styles.emptyText, color: 'var(--error)' }}>{error}</span>
            <button className="pressable" style={styles.emptyAction} onClick={() => void load(currentProjectId)}>
              重试
            </button>
          </div>
        )}

        {currentProjectId && unconfigured && (
          <div style={styles.noticeCard}>
            <Settings2 size={18} color="var(--primary)" />
            <div>
              <div style={styles.noticeTitle}>灵感助手还没配置</div>
              <div style={styles.noticeText}>到 PC 端「灵感」页为本项目配置整理助手,记录的灵感就会由 AI 自动整理。</div>
            </div>
          </div>
        )}

        {currentProjectId && entry?.loaded && !unconfigured && visibleNotes.length === 0 && (
          <div style={styles.empty}>
            <Sparkles size={40} color="var(--text-muted)" strokeWidth={1.2} />
            <span style={styles.emptyText}>{EMPTY_TEXT[filter]}</span>
            {filter === 'all' && <span style={styles.emptyHint}>点右下角 +,随手记一条想法</span>}
          </div>
        )}

        {visibleNotes.map((note) => {
          const completed = isNoteCompleted(note)
          const meta = inspirationStatusMeta(note.status)
          return (
            <button
              key={note.id}
              className="card pressable"
              style={{ ...styles.card, ...(completed ? styles.cardCompleted : {}) }}
              onClick={() => navigate(`/inspiration/${note.id}`)}
            >
              <span style={styles.cardTitle}>{note.title || '未命名灵感'}</span>
              <span style={styles.cardExcerpt}>{noteExcerpt(note)}</span>
              <span style={styles.cardFoot}>
                <span style={styles.statusWrap}>
                  <i
                    style={{
                      ...styles.statusDot,
                      background: meta.color,
                      ...(meta.busy ? { animation: 'dot-breathe 1.2s ease-in-out infinite' } : {}),
                    }}
                  />
                  {meta.label}
                </span>
                <span style={styles.cardTime}>{noteTime(note)}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div style={styles.bbar}>
        <button className="pressable" style={styles.projChip} onClick={() => setSheetOpen(true)}>
          <span style={{ ...styles.projIcon, background: resolveColor(project) }}>{resolveIcon(project)}</span>
          <span style={styles.projName}>{project?.name ?? '选择项目'}</span>
          <ChevronUp size={14} color="var(--text-muted)" />
        </button>
        <button className="pressable" style={styles.addBtn} onClick={handleAdd} aria-label="记录灵感">
          <Plus size={24} color="#fff" strokeWidth={2.4} />
        </button>
      </div>

      {sheetOpen && (
        <div style={styles.overlay} onClick={() => setSheetOpen(false)}>
          <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
            <div style={styles.sheetCap} />
            <div style={styles.sheetTitle}>切换项目</div>
            <div style={styles.sheetList}>
              {sortedProjects.map((item) => {
                const current = item.id === currentProjectId
                const projectNotes = byProject[item.id]?.loaded ? byProject[item.id].notes.length : null
                return (
                  <button
                    key={item.id}
                    className="pressable"
                    style={styles.sheetItem}
                    onClick={() => {
                      setCurrentProject(item.id)
                      setSheetOpen(false)
                    }}
                  >
                    <span style={{ ...styles.projIcon, background: resolveColor(item) }}>{resolveIcon(item)}</span>
                    <span style={styles.sheetName}>{item.name}</span>
                    <span style={styles.sheetCount}>{projectNotes === null ? '' : `${projectNotes} 条`}</span>
                    {current && <Check size={18} color="var(--primary)" />}
                  </button>
                )
              })}
              {sortedProjects.length === 0 && <div style={styles.sheetEmpty}>还没有项目,到 PC 端创建后同步到这里</div>}
            </div>
          </div>
        </div>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    paddingTop: 'calc(12px + var(--safe-top))',
    background: 'var(--bg-card)',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
  },
  tasksBtn: {
    position: 'relative',
    width: 36,
    height: 36,
    borderRadius: 'var(--radius-sm)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-input)',
  },
  tasksBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    background: 'var(--warning)',
    color: '#fff',
    fontSize: 9,
    fontWeight: 700,
  },
  filterBar: {
    display: 'flex',
    gap: 8,
    padding: '4px 16px 10px',
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-light)',
    flexShrink: 0,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 12px',
    borderRadius: 16,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text-secondary)',
    background: 'var(--bg-input)',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
  },
  chipActive: {
    background: 'var(--primary)',
    color: '#fff',
    fontWeight: 600,
  },
  chipCount: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  chipCountActive: {
    color: 'rgba(255,255,255,.8)',
  },
  list: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '10px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  ptrRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '2px 0 6px',
    color: 'var(--text-muted)',
    fontSize: 12,
    flexShrink: 0,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    textAlign: 'left',
    padding: '13px 14px 11px',
    flexShrink: 0,
  },
  cardCompleted: {
    opacity: 0.62,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    wordBreak: 'break-word',
  },
  cardExcerpt: {
    marginTop: 4,
    fontSize: 12,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardFoot: {
    marginTop: 9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
  },
  cardTime: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '56px 24px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
    flexShrink: 0,
  },
  emptyText: {
    marginTop: 10,
    color: 'var(--text-muted)',
    fontSize: 14,
  },
  emptyHint: {
    color: 'var(--text-muted)',
    fontSize: 12,
  },
  emptyAction: {
    marginTop: 14,
    padding: '8px 22px',
    borderRadius: 18,
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
  },
  noticeCard: {
    display: 'flex',
    gap: 10,
    padding: '12px 14px',
    borderRadius: 'var(--radius)',
    background: 'var(--primary-bg)',
    flexShrink: 0,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  noticeText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
  },
  bbar: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    padding: '6px 12px',
    background: 'var(--bg-card)',
    borderTop: '1px solid var(--border-light)',
  },
  projChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 12px 8px 8px',
    borderRadius: 999,
    background: 'transparent',
    minWidth: 0,
  },
  projIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: '#fff',
    flexShrink: 0,
  },
  projName: {
    maxWidth: '42vw',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  addBtn: {
    marginLeft: 'auto',
    width: 46,
    height: 46,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--primary)',
    boxShadow: '0 4px 14px rgba(108, 92, 231, 0.38)',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,.4)',
    zIndex: 998,
    display: 'flex',
    alignItems: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxHeight: '62vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg-card)',
    borderRadius: '16px 16px 0 0',
  },
  sheetCap: {
    width: 36,
    height: 4,
    borderRadius: 2,
    background: 'var(--border)',
    margin: '10px auto 0',
    flexShrink: 0,
  },
  sheetTitle: {
    padding: '10px 20px 8px',
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary)',
    flexShrink: 0,
  },
  sheetList: {
    overflowY: 'auto',
    padding: '0 8px calc(10px + var(--safe-bottom))',
  },
  sheetItem: {
    width: '100%',
    minHeight: 50,
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    textAlign: 'left',
    borderRadius: 'var(--radius-sm)',
  },
  sheetName: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sheetCount: {
    fontSize: 12,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  sheetEmpty: {
    padding: '28px 16px',
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: 13,
  },
}
