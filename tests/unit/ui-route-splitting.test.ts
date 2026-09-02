import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(resolve('ui/src/App.tsx'), 'utf8')
const lazySource = readFileSync(resolve('ui/src/routes/lazy-pages.tsx'), 'utf8')
const routeBoundarySource = readFileSync(resolve('ui/src/components/routing/RouteBoundary.tsx'), 'utf8')
const assistantRailSource = readFileSync(
  resolve('ui/src/components/global-assistant/GlobalAssistantRail.tsx'),
  'utf8',
)

const ROUTE_MODULES = [
  'Dashboard',
  'Workspace',
  'TaskBoard',
  'TaskModesSettings',
  'Schedule',
  'EventCenter',
  'KnowledgeBase',
  'AgentMemory',
  'AgentSquare',
  'SkillCenter',
  'ToolManager',
  'Settings',
  'Projects',
  'TemplatesPage',
  'Widget',
  'AccessTokenPage',
  'share/GuestChatPage',
  'share/ShareManagePage',
]

describe('UI route splitting boundary', () => {
  it('keeps eager page modules out of the application shell', () => {
    expect(appSource).not.toMatch(/from ['"]\.\/pages\//)
    expect(appSource).toContain("from './routes/lazy-pages'")
    expect(routeBoundarySource).toContain('<Suspense')
  })

  it('loads business listeners only after the realtime connection succeeds', () => {
    expect(appSource).toContain("import('./app-runtime-bootstrap')")
    expect(appSource).not.toContain("from './stores/session.store'")
    expect(appSource).not.toContain("from './stores/task.store'")
    expect(appSource).not.toContain("from './stores/agent.store'")
    expect(appSource).not.toContain("from './stores/rule.store'")
  })

  it('defines a dynamic import for every routed page module', () => {
    for (const routeModule of ROUTE_MODULES) {
      expect(lazySource).toContain(`import('../pages/${routeModule}')`)
    }
    expect(lazySource).toContain("module.TaskBoard")
  })

  it('loads the global assistant conversation drawer only when it opens', () => {
    expect(assistantRailSource).not.toContain("import { GlobalAssistantDrawer }")
    expect(assistantRailSource).toContain("import('./GlobalAssistantDrawer')")
    expect(assistantRailSource).toContain('{open &&')
  })
})
