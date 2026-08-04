import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { getAgentAutonomyConfig } from '../../src/core/agent-autonomy-config.js'
import { autonomyReportStore } from '../../src/store/autonomy-reports.js'
import { agentStore } from '../../src/store/agents.js'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { sessionStore } from '../../src/store/sessions.js'
import { getHandler } from '../../src/tools/handlers/index.js'

const root = mkdtempSync(resolve(tmpdir(), 'ai-ide-autonomy-tools-'))
let workDir = ''
let caseIndex = 0

beforeEach(() => {
  closeDatabase()
  workDir = resolve(root, `case-${++caseIndex}`)
  mkdirSync(resolve(workDir, 'docs'), { recursive: true })
  writeFileSync(resolve(workDir, 'docs', 'report.md'), '# Report', 'utf8')
  initDatabase(resolve(workDir, 'test.sqlite'))
})

afterEach(() => closeDatabase())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('autonomy tools', () => {
  test('updates plan and stores one Markdown report with safe attachments', async () => {
    const fixture = createFixture()
    const planHandler = getHandler('studio.autonomy.plan.update')
    const reportHandler = getHandler('studio.autonomy.report')
    expect(planHandler).toBeDefined()
    expect(reportHandler).toBeDefined()
    if (!planHandler || !reportHandler) return
    const context = {
      projectId: fixture.project.id,
      agentId: fixture.agent.id,
      sessionId: fixture.session.id,
      workDir,
    }

    await planHandler.execute({
      date: '2026-08-05',
      items: [
        { id: 'scan', title: '扫描问题', status: 'current' },
        { id: 'report', title: '形成结论', status: 'next', note: '只汇报新信息' },
      ],
    }, context)
    expect(getAgentAutonomyConfig(fixture.agent.id).plan.items).toHaveLength(2)

    const result = await reportHandler.execute({
      title: '依赖风险',
      summary: '发现一个需要处理的依赖风险。',
      priority: 'P1',
      markdown: '## 结论\n\n请升级依赖。',
      attachments: [{ path: 'docs/report.md', title: '详细报告' }],
    }, context)
    const output = JSON.parse(result.content[0].text) as { report: { id: string } }
    expect(autonomyReportStore.get(output.report.id)).toMatchObject({
      agent_id: fixture.agent.id,
      session_id: fixture.session.id,
      priority: 'P1',
      body_markdown: '## 结论\n\n请升级依赖。',
      attachments: [{ path: 'docs/report.md', title: '详细报告' }],
    })
  })

  test('rejects normal Sessions and unsafe attachment paths', async () => {
    const fixture = createFixture()
    const handler = getHandler('studio.autonomy.report')
    expect(handler).toBeDefined()
    if (!handler) return
    const normal = sessionStore.create({ agentId: fixture.agent.id, projectId: fixture.project.id })
    const input = { title: 'Title', summary: 'Summary', priority: 'P2', markdown: 'Body' }

    await expect(handler.execute(input, {
      projectId: fixture.project.id,
      agentId: fixture.agent.id,
      sessionId: normal.id,
      workDir,
    })).rejects.toThrow('只能在项目自主 Session')

    await expect(handler.execute({ ...input, attachments: [{ path: '../secret.md' }] }, {
      projectId: fixture.project.id,
      agentId: fixture.agent.id,
      sessionId: fixture.session.id,
      workDir,
    })).rejects.toThrow('项目内非隐藏文件')
  })
})

function createFixture() {
  const project = projectStore.create({ name: 'Project', workDir })
  const agent = agentStore.create({ name: 'Researcher', type: 'pm', runtime: 'mock', projectId: project.id })
  const session = sessionStore.create({ agentId: agent.id, projectId: project.id, purpose: 'autonomy' })
  return { project, agent, session }
}
