import { lazy } from 'react'

export const Dashboard = lazy(() => import('../pages/Dashboard'))
export const Workspace = lazy(() => import('../pages/Workspace'))
export const TaskBoard = lazy(() => import('../pages/TaskBoard').then((module) => ({
  default: module.TaskBoard,
})))
export const TaskModesSettings = lazy(() => import('../pages/TaskModesSettings'))
export const Schedule = lazy(() => import('../pages/Schedule'))
export const EventCenter = lazy(() => import('../pages/EventCenter'))
export const KnowledgeBase = lazy(() => import('../pages/KnowledgeBase'))
export const AgentMemory = lazy(() => import('../pages/AgentMemory'))
export const Autonomy = lazy(() => import('../pages/Autonomy').then((module) => ({ default: module.Autonomy })))
export const Secretary = lazy(() => import('../pages/Secretary').then((module) => ({ default: module.Secretary })))
export const Inspiration = lazy(() => import('../pages/Inspiration').then((module) => ({ default: module.Inspiration })))
export const AgentSquare = lazy(() => import('../pages/AgentSquare'))
export const SkillCenter = lazy(() => import('../pages/SkillCenter'))
export const ToolManager = lazy(() => import('../pages/ToolManager'))
export const Settings = lazy(() => import('../pages/Settings'))
export const Projects = lazy(() => import('../pages/Projects'))
export const TemplatesPage = lazy(() => import('../pages/TemplatesPage'))
export const WidgetPage = lazy(() => import('../pages/Widget'))
export const AccessTokenPage = lazy(() => import('../pages/AccessTokenPage'))
export const GuestChatPage = lazy(() => import('../pages/share/GuestChatPage'))
export const ShareManagePage = lazy(() => import('../pages/share/ShareManagePage'))
export const PinnedSessions = lazy(() => import('../pages/PinnedSessions').then((module) => ({
  default: module.PinnedSessions,
})))
export const UpdatesPage = lazy(() => import('../pages/UpdatesPage').then((module) => ({
  default: module.UpdatesPage,
})))
export const ReadingPage = lazy(() => import('../pages/reading/ReadingPage').then((module) => ({
  default: module.ReadingPage,
})))
