import { lazyWithRecovery } from './lazy-with-recovery'

export const Dashboard = lazyWithRecovery(() => import('../pages/Dashboard'))
export const Workspace = lazyWithRecovery(() => import('../pages/Workspace'))
export const TaskBoard = lazyWithRecovery(() => import('../pages/TaskBoard').then((module) => ({
  default: module.TaskBoard,
})))
export const TaskModesSettings = lazyWithRecovery(() => import('../pages/TaskModesSettings'))
export const Schedule = lazyWithRecovery(() => import('../pages/Schedule'))
export const EventCenter = lazyWithRecovery(() => import('../pages/EventCenter'))
export const KnowledgeBase = lazyWithRecovery(() => import('../pages/KnowledgeBase'))
export const AgentMemory = lazyWithRecovery(() => import('../pages/AgentMemory'))
export const Autonomy = lazyWithRecovery(() => import('../pages/Autonomy').then((module) => ({ default: module.Autonomy })))
export const Secretary = lazyWithRecovery(() => import('../pages/Secretary').then((module) => ({ default: module.Secretary })))
export const Inspiration = lazyWithRecovery(() => import('../pages/Inspiration').then((module) => ({ default: module.Inspiration })))
export const AgentSquare = lazyWithRecovery(() => import('../pages/AgentSquare'))
export const SkillCenter = lazyWithRecovery(() => import('../pages/SkillCenter'))
export const ToolManager = lazyWithRecovery(() => import('../pages/ToolManager'))
export const Settings = lazyWithRecovery(() => import('../pages/Settings'))
export const Projects = lazyWithRecovery(() => import('../pages/Projects'))
export const TemplatesPage = lazyWithRecovery(() => import('../pages/TemplatesPage'))
export const WidgetPage = lazyWithRecovery(() => import('../pages/Widget'))
export const AccessTokenPage = lazyWithRecovery(() => import('../pages/AccessTokenPage'))
export const GuestChatPage = lazyWithRecovery(() => import('../pages/share/GuestChatPage'))
export const ShareManagePage = lazyWithRecovery(() => import('../pages/share/ShareManagePage'))
export const PinnedSessions = lazyWithRecovery(() => import('../pages/PinnedSessions').then((module) => ({
  default: module.PinnedSessions,
})))
export const UpdatesPage = lazyWithRecovery(() => import('../pages/UpdatesPage').then((module) => ({
  default: module.UpdatesPage,
})))
export const SpreadsheetsPage = lazyWithRecovery(() => import('../pages/spreadsheets/SpreadsheetsPage').then((module) => ({
  default: module.SpreadsheetsPage,
})))
export const ReadingPage = lazyWithRecovery(() => import('../pages/reading/ReadingPage').then((module) => ({
  default: module.ReadingPage,
})))
