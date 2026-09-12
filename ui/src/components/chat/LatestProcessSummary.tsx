import { Check, Loader2, X } from 'lucide-react'
import type { ReactElement } from 'react'
import type { TurnProcessBlock } from '../../stores/turn-blocks'
import { toolSummary } from '../../pages/workspace/helpers'

export function LatestProcessSummary({ block, stage }: { block?: TurnProcessBlock; stage?: string }): ReactElement {
  const tool = block?.kind === 'tool' ? block.toolCall : undefined
  const status = tool?.status
  const completed = status === 'completed'
  const failed = status === 'failed'
  const labels = { thinking: '正在思考', note: '正在整理回复', plan: '更新计划', permission: '等待权限确认', elicitation: '等待补充信息', file_change: '更新文件变更', stage: '正在执行', tool: '正在执行' }
  const summary = stage || (tool ? toolSummary(tool) : block ? labels[block.kind] : '正在思考')
  return <div data-latest-process style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', margin: '6px 0', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 0 }}>
    {failed ? <X size={12} color="var(--red)" /> : completed ? <Check size={12} color="var(--green)" /> : <Loader2 size={12} style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />}
    <span title={summary} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>{summary.slice(0, 240)}</span>
    {tool && <span style={{ flexShrink: 0, color: failed ? 'var(--red)' : 'var(--text-3)' }}>{failed ? '失败' : completed ? '已完成' : status === 'pending' ? '等待' : '执行中'}</span>}
  </div>
}
