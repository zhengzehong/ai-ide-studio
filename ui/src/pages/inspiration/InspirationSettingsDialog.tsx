import { Save, X } from 'lucide-react'
import { useState } from 'react'
import type { AgentData } from '../../stores/agent.store'
import type { InspirationConfig } from '../../stores/inspiration.store'

interface InspirationSettingsDialogProps {
  config: InspirationConfig
  agents: AgentData[]
  saving: boolean
  onClose: () => void
  onSave: (input: { organizerAgentId: string; organizationPrompt: string; autoOrganize: boolean }) => Promise<void>
  onRebuild: (agentId: string) => Promise<void>
}

const defaultPrompt = '保留用户原意，先给出明确判断，再输出方案、风险和需要确认的问题。只有内容足够明确时才生成候选任务；每个候选任务必须包含标题、任务说明和推荐 Agent 理由。'

export function InspirationSettingsDialog({ config, agents, saving, onClose, onSave, onRebuild }: InspirationSettingsDialogProps) {
  const [agentId, setAgentId] = useState(config.organizerAgentId ?? agents[0]?.id ?? '')
  const [organizationPrompt, setOrganizationPrompt] = useState(config.organizationPrompt || defaultPrompt)
  const [autoOrganize, setAutoOrganize] = useState(config.autoOrganize)
  const [error, setError] = useState<string | null>(null)
  const agentChanged = !!config.organizerAgentId && config.organizerAgentId !== agentId

  const submit = async (): Promise<void> => {
    setError(null)
    try {
      if (agentChanged) {
        if (!window.confirm('更换整理 Agent 会创建新的长期灵感会话，旧会话仍保留。是否继续？')) return
        await onRebuild(agentId)
      }
      await onSave({ organizerAgentId: agentId, organizationPrompt, autoOrganize })
    } catch (error) {
      setError(error instanceof Error ? error.message : '灵感设置保存失败')
    }
  }

  return (
    <div className="inspiration-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="inspiration-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="inspiration-settings-title">
        <header><div><h2 id="inspiration-settings-title">项目灵感设置</h2><span>一个项目只绑定一个当前长期灵感会话</span></div><button type="button" className="inspiration-icon-button" onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button></header>
        <div className="inspiration-dialog-body">
          <label><span>整理 Agent</span><select value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">请选择 Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><small>模型档案、模式和推理强度继承该 Agent 及其长期 Session。</small></label>
          <label><span>整理提示词</span><textarea value={organizationPrompt} onChange={(event) => setOrganizationPrompt(event.target.value)} maxLength={20_000} /></label>
          <label className="inspiration-toggle"><input type="checkbox" checked={autoOrganize} onChange={(event) => setAutoOrganize(event.target.checked)} /><span><strong>保存后自动整理</strong><small>原文先保存，再进入项目灵感会话。</small></span></label>
          {error && <div className="inspiration-error">{error}</div>}
        </div>
        <footer><button type="button" className="inspiration-secondary" onClick={onClose}>取消</button><button type="button" className="inspiration-primary" disabled={!agentId || saving} onClick={() => void submit()}><Save size={15} />{saving ? '保存中…' : '保存设置'}</button></footer>
      </section>
    </div>
  )
}
