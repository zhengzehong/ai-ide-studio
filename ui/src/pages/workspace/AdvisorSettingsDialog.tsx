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

/** 参谋设置弹窗：启用开关 / 参谋 Agent / 高级折叠（自定义偏好 + 恢复默认），无每日上限项（U-18~U-21） */
export function AdvisorSettingsDialog({ config, agents, saving, onClose, onSave, onRebuild }: AdvisorSettingsDialogProps) {
  const [agentId, setAgentId] = useState(config.advisorAgentId ?? agents[0]?.id ?? '')
  const [advisorPrompt, setAdvisorPrompt] = useState(config.advisorPrompt || config.defaultAdvisorPrompt || '')
  const [useDefault, setUseDefault] = useState(!config.advisorPrompt)
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
      await onSave({ advisorAgentId: agentId, advisorPrompt: useDefault ? '' : advisorPrompt, enabled })
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
              <small>项目变化每 15 分钟合并分析，只有值得考虑的发现才会生成建议。</small>
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
                    onChange={(event) => { setUseDefault(false); setAdvisorPrompt(event.target.value) }}
                    maxLength={20_000}
                  />
                  <small>{useDefault ? '使用系统默认，随版本更新。' : '使用自定义偏好，不会被系统更新覆盖。'}</small>
                </label>
                <div>
                  <button type="button" className="advisor-button-secondary" onClick={() => { setUseDefault(true); setAdvisorPrompt(config.defaultAdvisorPrompt || '') }}>
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
