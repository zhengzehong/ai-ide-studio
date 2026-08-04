import { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import { PresentedFilesModal } from '../../components/file-viewer/PresentedFilesModal'
import type { FilesPresentationInfo } from '../../stores/session-events'
import type { AutonomyReportData } from '../../stores/autonomy.store'

export function AutonomyReportStream({ reports }: { reports: AutonomyReportData[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(reports.slice(0, 1).map((report) => report.id)))
  const [files, setFiles] = useState<FilesPresentationInfo | null>(null)

  const toggle = (id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="autonomy-report-column">
      <div className="autonomy-panel-title">汇报</div>
      <div className="autonomy-report-scroll">
        {reports.map((report) => {
          const open = openIds.has(report.id)
          return (
            <article key={report.id} className="autonomy-report">
              <button type="button" className="autonomy-report-head" onClick={() => toggle(report.id)}>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className={`autonomy-priority priority-${report.priority.toLowerCase()}`}>{report.priority}</span>
                <span className="autonomy-report-heading">
                  <strong>{report.title}</strong>
                  <small>{formatTime(report.created_at)}</small>
                </span>
              </button>
              <p className="autonomy-report-summary">{report.summary}</p>
              {open && (
                <div className="autonomy-report-body">
                  <MarkdownRenderer content={report.body_markdown} />
                  {report.attachments.length > 0 && (
                    <button type="button" className="autonomy-files-button" onClick={() => setFiles(toPresentation(report))}>
                      <FileText size={14} /> 查看附件（{report.attachments.length}）
                    </button>
                  )}
                </div>
              )}
            </article>
          )
        })}
        {reports.length === 0 && <div className="autonomy-empty">Agent 暂无汇报</div>}
      </div>
      {files && <PresentedFilesModal presentation={files} onClose={() => setFiles(null)} />}
    </section>
  )
}

function toPresentation(report: AutonomyReportData): FilesPresentationInfo {
  return {
    kind: 'files',
    presentationId: `autonomy-${report.id}`,
    projectId: report.project_id,
    title: report.title,
    createdAt: report.created_at,
    files: report.attachments.map((attachment) => {
      const name = attachment.path.split('/').at(-1) ?? attachment.path
      const dot = name.lastIndexOf('.')
      const extension = dot >= 0 ? name.slice(dot).toLowerCase() : ''
      return {
        path: attachment.path,
        title: attachment.title ?? name,
        name,
        extension,
        size: 0,
        kind: fileKind(extension),
        language: extension === '.md' || extension === '.mdx' ? 'markdown' : 'plaintext',
      }
    }),
  }
}

function fileKind(extension: string): 'text' | 'image' | 'binary' {
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg'].includes(extension)) {
    return 'image'
  }
  if (['.pdf', '.zip', '.gz', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(extension)) {
    return 'binary'
  }
  return 'text'
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
