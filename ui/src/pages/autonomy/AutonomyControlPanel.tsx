import { useState } from 'react'
import { Check, MemoryStick, Plus, Save, Settings2, X } from 'lucide-react'
import { MarkdownRenderer } from '../../components/MarkdownRenderer'
import type { AgentAutonomyStateData, AutonomyPlanStatus } from '../../stores/autonomy.store'

interface AutonomyControlPanelProps {
  state: AgentAutonomyStateData
  saving: boolean
  onAddInterest: (text: string) => Promise<void>
  onRemoveInterest: (interestId: string) => Promise<void>
  onSavePrompt: (prompt: string) => Promise<void>
}

export function AutonomyControlPanel({
  state,
  saving,
  onAddInterest,
  onRemoveInterest,
  onSavePrompt,
}: AutonomyControlPanelProps) {
  const [interest, setInterest] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState(state.config.prompt)

  const addInterest = async (): Promise<void> => {
    const value = interest.trim()
    if (!value) return
    await onAddInterest(value)
    setInterest('')
  }

  return (
    <aside className="autonomy-control-panel">
      <section className="autonomy-control-section">
        <div className="autonomy-section-heading">
          <strong>关注方向</strong>
          <span>{state.config.interests.length}</span>
        </div>
        <div className="autonomy-interest-input">
          <input
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addInterest() }}
            placeholder="添加关注方向"
            maxLength={1_000}
          />
          <button type="button" title="添加关注方向" aria-label="添加关注方向" disabled={saving || !interest.trim()} onClick={() => void addInterest()}>
            <Plus size={15} />
          </button>
        </div>
        <div className="autonomy-interest-list">
          {state.config.interests.map((item) => (
            <span key={item.id} className="autonomy-interest-chip">
              {item.text}
              <button type="button" title="删除关注方向" aria-label={`删除 ${item.text}`} disabled={saving} onClick={() => void onRemoveInterest(item.id)}>
                <X size={11} />
              </button>
            </span>
          ))}
          {state.config.interests.length === 0 && <small className="autonomy-muted">尚未添加关注方向</small>}
        </div>
      </section>

      <section className="autonomy-control-section">
        <div className="autonomy-section-heading">
          <strong>当天排班</strong>
          <span>{state.config.plan.date}</span>
        </div>
        <div className="autonomy-plan-list">
          {state.config.plan.items.map((item) => (
            <div key={item.id} className="autonomy-plan-item">
              <span className={`autonomy-plan-status status-${item.status}`}>{planLabel(item.status)}</span>
              <div><strong>{item.title}</strong>{item.note && <small>{item.note}</small>}</div>
            </div>
          ))}
          {state.config.plan.items.length === 0 && <small className="autonomy-muted">Agent 尚未建立排班</small>}
        </div>
      </section>

      <section className="autonomy-control-section">
        <button type="button" className="autonomy-section-button" onClick={() => setPromptOpen((open) => !open)}>
          <Settings2 size={14} /> 独立自主提示词
        </button>
        {promptOpen && (
          <div className="autonomy-prompt-editor">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="说明这个 Agent 在自主运行时的职责与判断标准"
              maxLength={20_000}
            />
            <button type="button" disabled={saving || prompt === state.config.prompt} onClick={() => void onSavePrompt(prompt)}>
              {prompt === state.config.prompt ? <Check size={14} /> : <Save size={14} />}
              {prompt === state.config.prompt ? '已保存' : '保存'}
            </button>
          </div>
        )}
      </section>

      <section className="autonomy-control-section autonomy-memory-section">
        <div className="autonomy-section-heading">
          <strong><MemoryStick size={14} /> 工作记忆</strong>
          {state.memory.truncated && <span>已截断</span>}
        </div>
        <div className="autonomy-memory-body">
          {state.memory.content
            ? <MarkdownRenderer content={state.memory.content} />
            : <small className="autonomy-muted">启用后创建 memory.md</small>}
        </div>
      </section>
    </aside>
  )
}

function planLabel(status: AutonomyPlanStatus): string {
  if (status === 'current') return '当前'
  if (status === 'done') return '完成'
  return '下一步'
}
