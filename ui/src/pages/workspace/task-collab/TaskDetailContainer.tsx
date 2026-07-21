import { useEffect } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTaskStore } from '../../../stores/task.store'
import { TaskDetailInline, type TaskDetailInlineProps } from './TaskDetailInline'
import { resolveTaskDetail } from './task-detail-state'

export function TaskDetailContainer(props: TaskDetailInlineProps) {
  const taskId = props.task.id
  const detail = useTaskStore((state) => state.taskDetailsById[taskId])
  const loading = useTaskStore((state) => !!state.taskDetailLoadingById[taskId])
  const error = useTaskStore((state) => state.taskDetailErrorById[taskId] ?? null)
  const fetchTaskDetail = useTaskStore((state) => state.fetchTaskDetail)
  const resolvedTask = resolveTaskDetail(props.task, detail)

  useEffect(() => {
    void fetchTaskDetail(taskId).catch(() => undefined)
  }, [fetchTaskDetail, taskId])

  if (!resolvedTask) {
    return (
      <div
        role={error ? 'alert' : undefined}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: 'var(--text-3)',
          padding: 24,
          textAlign: 'center',
        }}
      >
        {error ? (
          <>
            <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>
            <button
              type="button"
              onClick={() => void fetchTaskDetail(taskId, { force: true }).catch(() => undefined)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-0)',
                color: 'var(--text-2)',
                padding: '6px 10px',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} /> 重试
            </button>
          </>
        ) : (
          <>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 13 }}>{loading ? '正在加载任务详情...' : '正在准备任务详情...'}</div>
          </>
        )}
      </div>
    )
  }

  return <TaskDetailInline {...props} task={resolvedTask} />
}
