import { Save, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { AdvisorConfig } from '../../stores/advisor.store'

interface AdvisorSettingsDialogProps {
  config: AdvisorConfig
  agents: AgentData[]
  saving: boolean
  onClose: () => void
  onSave: (input: { advisorAgentId: string; advisorPrompt: string; enabled: boolean }) => Promise<void>
  onRebuild: (agentId: string) => Promise<void>
}

/** 与 src/core/project-advisor.ts 的 DEFAULT_ADVISOR_PROMPT 保持同步 */
const DEFAULT_ADVISOR_PROMPT_TEXT = [
  '你是当前项目的 AI 参谋。你会收到项目中任意 Agent 会话刚完成一轮的推送（用户输入、AI 回复、来源会话），并可调用 agent.session.messages 查看该会话更早历史。',
  '基于本轮内容 + 全局聚合方向，判断是否值得给用户提出建议：',
  '- 有值得说的：调用 suggestion.present 提交 1~3 条建议；多条建议之间不要重复。',
  '- 没有值得说的：调用 suggestion.present 传空数组并用 noFindingReason 说明（无货沉默是常态）。',
  '每条建议必须包含：类型（plan=附完整 HTML 方案文档 / action=说明即执行包）、标题、预填执行包（背景/目标/交付物/验收标准）、推荐 Agent 和理由、来源佐证会话。',
  'plan 类型必须同时提交 artifactName 和 artifactHtml（完整可打开的 HTML 方案文档）。',
  '不得直接创建或派发任务，必须调用 suggestion.present 提交，等待用户确认。',
].join('\n')

/** 参谋设置弹窗：启用开关 / 参谋 Agent / 高级折叠（自定义偏好 + 恢复默认），无每日上限项（U-18~U-21） */
export function AdvisorSettingsDialog({ config, agents, saving, onClose, onSave, onRebuild }: AdvisorSettingsDialogProps) {
  const [agentId, setAgentId] = useState(config.advisorAgentId ?? agents[0]?.id ?? '')
  const [advisorPrompt, setAdvisorPrompt] = useState(config.advisorPrompt || DEFAULT_ADVISOR_PROMPT_TEXT)
  const [enabled, setEnabled] = useState(config.enabled)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agentChanged = !!config.advisorAgentId && config.advisorAgentId !== agentId

  const submit = async (): Promise<void> => {
    setError(null)
    try {
      if (agentChanged) {
        if (!window.confirm('更换参谋 Agent 会创建新的参谋会话，旧会话仍保留。是否继续？')) return
        await onRebuild(agentId)
      }
      await onSave({ advisorAgentId: agentId, advisorPrompt, enabled })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '参谋设置保存失败')
    }
  }

  return (
    <div className="advisor-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="advisor-dialog advisor-dialog-settings" role="dialog" aria-modal="true" aria-labelledby="advisor-settings-title">
        <header>
          <div>
            <h2 id="advisor-settings-title">参谋设置</h2>
            <span>一个项目绑定一个参谋 Agent 与一个参谋会话</span>
          </div>
          <button type="button" className="advisor-icon-button" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={17} />
          </button>
        </header>
        <div className="advisor-dialog-body">
          <label className="advisor-toggle">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span>
              启用 AI 参谋
              <small>开启后，参谋会观察项目内 Agent 会话的每一轮，在值得提建议时推送建议卡。</small>
            </span>
          </label>
          <label>
            <span>参谋 Agent</span>
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">请选择 Agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <small>模型档案、模式和推理强度继承该 Agent 及其专属参谋会话。</small>
          </label>
          <div className="advisor-advanced">
            <button type="button" onClick={() => setAdvancedOpen((prev) => !prev)}>
              高级：自定义参谋偏好 {advancedOpen ? '▲' : '▼'}
            </button>
            {advancedOpen && (
              <div className="advisor-advanced-body">
                <label>
                  <span>参谋偏好</span>
                  <textarea
                    className="advisor-prompt-textarea"
                    value={advisorPrompt}
                    onChange={(event) => setAdvisorPrompt(event.target.value)}
                    maxLength={20_000}
                  />
                  <small>追加到参谋推送包，固定发布协议不会被它覆盖。</small>
                </label>
                <div>
                  <button type="button" className="advisor-button-secondary" onClick={() => setAdvisorPrompt(DEFAULT_ADVISOR_PROMPT_TEXT)}>
                    恢复默认
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && <div className="advisor-error-inline">{error}</div>}
        </div>
        <footer>
          <button type="button" className="advisor-button-secondary" onClick={onClose}>取消</button>
          <button type="button" className="advisor-button-primary" disabled={!agentId || saving} onClick={() => void submit()}>
            <Save size={15} />{saving ? '保存中…' : '保存设置'}
          </button>
        </footer>
      </section>
    </div>
  )
}
