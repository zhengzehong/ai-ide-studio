import { useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import Dashboard from './pages/Dashboard'
import Workspace from './pages/Workspace'
import TaskBoard from './pages/TaskBoard'
import Schedule from './pages/Schedule'
import EventCenter from './pages/EventCenter'
import KnowledgeBase from './pages/KnowledgeBase'
import AgentSquare from './pages/AgentSquare'
import SkillCenter from './pages/SkillCenter'
import ToolManager from './pages/ToolManager'
import Settings from './pages/Settings'
import WidgetPage from './pages/Widget'
import AccessTokenPage from './pages/AccessTokenPage'
import { useConnectionStore } from './stores/connection.store'
import { useAgentStore } from './stores/agent.store'
import { useSessionStore } from './stores/session.store'
import { useTaskStore } from './stores/task.store'
import { useRuleStore } from './stores/rule.store'
import { useProjectStore } from './stores/project.store'
import { useTemplateStore } from './stores/template.store'
import { useToolStore } from './stores/tool.store'
import { useModelStore } from './stores/model.store'
import { useSkillStore } from './stores/skill.store'
import { useTeamStore } from './stores/team.store'
import { useTimelineStore } from './stores/timeline.store'
import { useKnowledgeBaseStore } from './stores/knowledge-base.store'

export default function App() {
  const init = useConnectionStore((s) => s.init)
  const connected = useConnectionStore((s) => s.connected)
  const authRequired = useConnectionStore((s) => s.authRequired)
  const listenersReady = useRef(false)

  useEffect(() => {
    init()
  }, [init])

  useEffect(() => {
    if (!connected) return

    useAgentStore.getState().fetchAgents()
    useTaskStore.getState().fetchTasks()
    useRuleStore.getState().fetchRules()
    useProjectStore.getState().fetchProjects()
    useTemplateStore.getState().fetchTemplates()
    useToolStore.getState().fetchTools()
    useToolStore.getState().fetchProfiles()
    useModelStore.getState().fetchProviders()
    useSkillStore.getState().fetchSkills()

    if (!listenersReady.current) {
      listenersReady.current = true
      const off1 = useAgentStore.getState().setupListeners()
      const off2 = useSessionStore.getState().setupListeners()
      const off3 = useTaskStore.getState().setupListeners()
      const off4 = useRuleStore.getState().setupListeners()
      const off5 = useTeamStore.getState().setupListeners(() => useSessionStore.getState().currentSessionId)
      const off6 = useTimelineStore.getState().setupListeners()
      const off7 = useKnowledgeBaseStore.getState().setupListeners()
      return () => {
        off1()
        off2()
        off3()
        off4()
        off5()
        off6()
        off7()
        listenersReady.current = false
      }
    }
  }, [connected])

  return authRequired ? (
    <AccessTokenPage />
  ) : (
    <BrowserRouter>
      <Routes>
        <Route path="/widget" element={<WidgetPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<AgentSquare />} />
          <Route path="/skills" element={<SkillCenter />} />
          <Route path="/tools" element={<ToolManager />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/tasks" element={<TaskBoard />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/events" element={<EventCenter />} />
          <Route path="/knowledge" element={<KnowledgeBase />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
