import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildAiIdeSystemPrompt } from '../../src/core/ai-ide-system-prompt.js'
import { getHandler } from '../../src/tools/handlers/index.js'

let workDir: string

beforeEach(() => {
  workDir = mkdtempSync(resolve(tmpdir(), 'ai-ide-files-present-'))
  mkdirSync(resolve(workDir, 'docs'))
  writeFileSync(resolve(workDir, 'docs', 'report.md'), '# Report')
  writeFileSync(resolve(workDir, 'docs', 'plan.md'), '# Plan')
  writeFileSync(resolve(workDir, '.env'), 'TOKEN=secret')
})

afterEach(() => rmSync(workDir, { recursive: true, force: true }))

describe('files.present handler', () => {
  test('returns a metadata-only manifest for multiple project files', async () => {
    const handler = getHandler('files.present')
    expect(handler).toBeDefined()
    if (!handler) return

    const result = await handler.execute({
      title: '本次交付',
      files: [
        { path: 'docs/report.md', title: '分析报告' },
        { path: 'docs/plan.md', title: '实施方案' },
      ],
    }, { projectId: 'project-1', workDir })

    expect(result.isError).not.toBe(true)
    const output = JSON.parse(result.content[0].text) as Record<string, unknown>
    expect(output).toMatchObject({
      kind: 'files',
      projectId: 'project-1',
      title: '本次交付',
    })
    expect(output.presentationId).toMatch(/^files-/)
    expect(output.createdAt).toEqual(expect.any(String))
    expect(output.files).toEqual([
      expect.objectContaining({ path: 'docs/report.md', title: '分析报告', extension: '.md', kind: 'text' }),
      expect.objectContaining({ path: 'docs/plan.md', title: '实施方案', extension: '.md', kind: 'text' }),
    ])
    expect(JSON.stringify(output)).not.toContain('# Report')
  })

  test.each([
    { files: [] },
    { files: [{ path: 'docs/report.md' }, { path: 'docs/report.md' }] },
    { files: [{ path: '../outside.md' }] },
    { files: [{ path: '.env' }] },
    { files: Array.from({ length: 21 }, (_, index) => ({ path: `docs/file-${index}.md` })) },
  ])('rejects unsafe or invalid file input %#', async (input) => {
    const handler = getHandler('files.present')
    expect(handler).toBeDefined()
    if (!handler) return
    const result = await handler.execute(input, { projectId: 'project-1', workDir })
    expect(result.isError).toBe(true)
  })

  test('requires project and work directory context', async () => {
    const handler = getHandler('files.present')
    expect(handler).toBeDefined()
    if (!handler) return
    const result = await handler.execute({ files: [{ path: 'docs/report.md' }] }, {})
    expect(result.isError).toBe(true)
  })
})

test('AI IDE system prompt tells agents to present user-facing deliverables', () => {
  const prompt = buildAiIdeSystemPrompt()
  expect(prompt).toContain('files.present')
  expect(prompt).toContain('交付文件')
})
