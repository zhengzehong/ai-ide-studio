import { RotateCcw } from 'lucide-react'
import type { KnowledgeActivityData, KnowledgePageData } from '../../stores/knowledge-base.store'

interface KnowledgeActivityPanelProps {
  activities: KnowledgeActivityData[]
  pages: KnowledgePageData[]
  onRevert: (activityId: string) => void
}

const ACT_LABELS: Record<string, string> = {
  create: '新建页面',
  edit: '编辑页面',
  refresh: '刷新代码页',
  revert: '撤销',
  mount: '挂载',
  unmount: '卸载',
  create_kb: '新建知识库',
}

export function KnowledgeActivityPanel({ activities, pages, onRevert }: KnowledgeActivityPanelProps) {
  const pageMap = new Map(pages.map((page) => [page.id, page]))

  return (
    <aside className="kb-activity">
      <div className="kb-panel-header kb-panel-header--compact">
        <div>
          <div className="kb-eyebrow">活动</div>
          <h2>{activities.length}</h2>
        </div>
      </div>

      <div className="kb-activity-list">
        {activities.length === 0 ? (
          <div className="kb-empty-mini">暂无活动</div>
        ) : (
          activities.map((activity) => {
            const page = activity.page_id ? pageMap.get(activity.page_id) : null
            const canRevert = !activity.reverted_at && (activity.act === 'create' || activity.act === 'edit' || activity.act === 'refresh')
            return (
              <div key={activity.id} className="kb-activity-item">
                <div className="kb-activity-top">
                  <strong>{ACT_LABELS[activity.act] ?? activity.act}</strong>
                  <span>{formatTime(activity.created_at)}</span>
                </div>
                <div className="kb-activity-meta">
                  <span>{activity.actor_type === 'human' ? '人工' : activity.actor}</span>
                  <span>{activity.tool}</span>
                </div>
                <div className="kb-activity-page">{page?.title ?? activity.page_id ?? '知识库'}</div>
                {activity.note && <div className="kb-activity-note">{activity.note}</div>}
                {activity.reverted_at && <div className="kb-activity-note">已撤销</div>}
                {canRevert && (
                  <button type="button" onClick={() => onRevert(activity.id)}>
                    <RotateCcw size={13} />撤销
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
