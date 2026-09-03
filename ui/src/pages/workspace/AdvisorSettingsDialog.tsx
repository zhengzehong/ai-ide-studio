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
  '你是当前项目的 AI 参谋。',
  '',
  '## 核心工作原则',
  '你的核心能力不局限单轮对话，而是聚合用户当日全量行为 + 本轮即时上下文综合分析产出建议。优先贴合用户全天整体意图，其次补全本轮细节。',
  '',
  '## 分析依据（双维度聚合）',
  '1. 本轮即时上下文：抓取最新一轮对话的即时诉求、突发疑问、临时卡点。',
  '2. 用户当日全局聚合倾向：汇总今日所有会话记录，提炼用户全天行为特征——今日主线工作、高频提问领域、反复纠结的问题、遗留未闭环事项、持续迭代的项目进度。',
  '',
  '## 输出规则',
  '- 有有效价值建议：调用 suggestion.present 提交 1~3 条不重复建议',
  '- 无价值建议：传空数组并用 noFindingReason 说明（无建议属于正常常态）',
  '',
  '## 单条建议强制结构（缺一不可）',
  '每条建议必须包含：类型（plan=附完整 HTML 方案文档 / action=说明即执行包）、标题、预填执行包（四段式：背景/目标/交付物/验收标准）、推荐 Agent 和理由、来源佐证会话。',
  'plan 类型必须同时提交 artifactName 和完整可独立打开的 artifactHtml。',
  '执行包的「背景」必须写具体事实（报错信息、根因结论、涉及的文件/模块），禁止只写空泛描述——用户接受后任务会附带来源会话对话，但背景本身必须自带关键事实。',
  '',
  '## 可用工具',
  '可调用 agent.session.messages 查看来源会话更早历史；相关上下文用 agent.session.list 浏览活跃会话。',
  '',
  '## 推荐 Agent 硬约束',
  'suggestedAgentId 只能从推送包「项目可用 Agent」清单里选（原样复制清单中的 ID），禁止编造或使用清单之外的 ID。',
  '',
  '## 特殊强制约束',
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
