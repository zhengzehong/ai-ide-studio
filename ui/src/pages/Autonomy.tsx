import { useEffect, useMemo } from 'react'
import { ExternalLink, Loader2, Play, Power, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useProjectScopeId } from '../hooks/use-project-scope'
import { useProjectNavigation } from '../hooks/use-project-navigation'
import { useAgentStore } from '../stores/agent.store'
import { useAutonomyStore } from '../stores/autonomy.store'
import { AutonomyAgentList } from './autonomy/AutonomyAgentList'
import { AutonomyControlPanel } from './autonomy/AutonomyControlPanel'
import { AutonomyReportStream } from './autonomy/AutonomyReportStream'
import './autonomy/autonomy.css'

export function Autonomy() {
  const projectId = useProjectScopeId()
  const { toProjectPath } = useProjectNavigation()
  const navigate = useNavigate()
  const agents = useAgentStore((state) => state.agents)
  const fetchAgents = useAgentStore((state) => state.fetchAgents)
  const states = useAutonomyStore((state) => state.states)
  const selectedAgentId = useAutonomyStore((state) => state.selectedAgentId)
  const selected = useAutonomyStore((state) => state.selected)
  const reports = useAutonomyStore((state) => state.reports)
  const loading = useAutonomyStore((state) => state.loading)
  const saving = useAutonomyStore((state) => state.saving)
  const error = useAutonomyStore((state) => state.error)
  const load = useAutonomyStore((state) => state.load)
  const selectAgent = useAutonomyStore((state) => state.selectAgent)
  const enable = useAutonomyStore((state) => state.enable)
  const disable = useAutonomyStore((state) => state.disable)
  const runNow = useAutonomyStore((state) => state.runNow)
  const updatePrompt = useAutonomyStore((state) => state.updatePrompt)
  const addInterest = useAutonomyStore((state) => state.addInterest)
  const removeInterest = useAutonomyStore((state) => state.removeInterest)
  const setupListeners = useAutonomyStore((state) => state.setupListeners)
  const clearError = useAutonomyStore((state) => state.clearError)

  useEffect(() => {
    void fetchAgents(projectId)
    void load(projectId)
  }, [fetchAgents, load, projectId])

  useEffect(() => setupListeners(), [setupListeners])

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId),
    [agents, selectedAgentId],
  )

  const openSession = (): void => {
    if (!selected?.session) return
    navigate(`${toProjectPath('/workspace')}?sessionId=${encodeURIComponent(selected.session.id)}`)
  }

  return (
    <div className="autonomy-page">
      <header className="autonomy-page-header">
        <div>
          <h1>自主工作</h1>
          <p>{selectedAgent ? `${selectedAgent.name} · 每 10 分钟检查` : '选择 Agent 管理自主运行'}</p>
        </div>
        <div className="autonomy-header-actions">
          <button type="button" className="autonomy-icon-button" title="刷新" aria-label="刷新" onClick={() => void load(projectId, selectedAgentId)}>
            <RefreshCw size={15} />
          </button>
          {selected?.session && (
            <button type="button" onClick={openSession}><ExternalLink size={14} /> 打开会话</button>
          )}
          {selected?.config.enabled && (
            <button type="button" disabled={saving} onClick={() => void runNow()}><Play size={14} /> 立即检查</button>
          )}
          {selected && (
            <button
              type="button"
              className={selected.config.enabled ? 'is-danger' : 'is-primary'}
              disabled={saving}
              onClick={() => void (selected.config.enabled ? disable() : enable())}
            >
              <Power size={14} /> {selected.config.enabled ? '停用' : '启用'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="autonomy-error">
          <span>{error}</span>
          <button type="button" onClick={clearError}>关闭</button>
        </div>
      )}

      <div className="autonomy-workbench">
        <AutonomyAgentList agents={agents} states={states} selectedAgentId={selectedAgentId} onSelect={(id) => void selectAgent(id)} />
        {loading && !selected ? (
          <div className="autonomy-loading"><Loader2 size={20} /> 正在加载...</div>
        ) : selected ? (
          <>
            <AutonomyReportStream key={`${selected.agentId}:${reports[0]?.id ?? 'empty'}`} reports={reports} />
            <AutonomyControlPanel
              key={`${selected.agentId}:${selected.config.prompt}`}
              state={selected}
              saving={saving}
              onAddInterest={addInterest}
              onRemoveInterest={removeInterest}
              onSavePrompt={updatePrompt}
            />
          </>
        ) : (
          <div className="autonomy-loading">当前项目没有可配置的 Agent</div>
        )}
      </div>
    </div>
  )
}
