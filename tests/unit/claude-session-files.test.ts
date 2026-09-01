import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cloneClaudeSessionFiles,
  encodeClaudeProjectPath,
  removeClaudeSessionFiles,
} from '../../src/acp/claude-session-files.js'

const SOURCE_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CWD = 'D:\\project_space\\sample'

let configDir = ''

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'claude-session-files-'))
})

afterEach(async () => {
  if (configDir) await rm(configDir, { recursive: true, force: true })
})

describe('cloneClaudeSessionFiles', () => {
  it('materializes a self-contained Claude fork without rewriting historical workspace paths', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    const sourceResourceDir = join(projectDir, SOURCE_ID)
    const sourceOutput = join(sourceResourceDir, 'tool-results', 'result.txt')
    await mkdir(join(sourceResourceDir, 'subagents'), { recursive: true })
    await mkdir(join(sourceResourceDir, 'tool-results'), { recursive: true })
    await writeFile(sourceOutput, 'large output', 'utf8')
    await writeFile(
      join(sourceResourceDir, 'subagents', 'agent-a.jsonl'),
      `${JSON.stringify({
        type: 'user',
        sessionId: SOURCE_ID,
        cwd: CWD,
        message: { content: `Read persisted output from ${sourceOutput}` },
      })}\n`,
      'utf8',
    )
    await writeFile(
      join(sourceResourceDir, 'subagents', 'agent-a.meta.json'),
      JSON.stringify({ agentType: 'general-purpose' }),
      'utf8',
    )
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      [
        JSON.stringify({ type: 'mode', mode: 'normal', sessionId: SOURCE_ID }),
        JSON.stringify({
          type: 'user',
          sessionId: SOURCE_ID,
          cwd: CWD,
          uuid: 'event-uuid',
          parentUuid: null,
          gitBranch: 'feature/source',
          message: {
            content: [
              { type: 'text', text: `Full output saved to: ${sourceOutput}` },
              { type: 'tool_use', input: { file_path: `${CWD}\\src\\index.ts` } },
            ],
          },
          toolUseResult: { persistedOutputPath: sourceOutput },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    const result = await cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })

    expect(result.lineCount).toBe(2)
    expect(result.resourceFilesCopied).toBe(3)
    const targetResourceDir = join(projectDir, TARGET_ID)
    const targetOutput = join(targetResourceDir, 'tool-results', 'result.txt')
    const targetLines = (await readFile(join(projectDir, `${TARGET_ID}.jsonl`), 'utf8'))
      .trimEnd()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(targetLines.every((line) => line.sessionId === TARGET_ID)).toBe(true)
    expect(targetLines[1]).toMatchObject({
      cwd: CWD,
      uuid: 'event-uuid',
      parentUuid: null,
      gitBranch: 'feature/source',
      toolUseResult: { persistedOutputPath: targetOutput },
    })
    expect(targetLines[1]).toMatchObject({
      message: {
        content: [
          { type: 'text', text: `Full output saved to: ${targetOutput}` },
          { type: 'tool_use', input: { file_path: `${CWD}\\src\\index.ts` } },
        ],
      },
    })
    expect(await readFile(targetOutput, 'utf8')).toBe('large output')

    const subagent = JSON.parse(
      (await readFile(join(targetResourceDir, 'subagents', 'agent-a.jsonl'), 'utf8')).trim(),
    ) as Record<string, unknown>
    expect(subagent.sessionId).toBe(TARGET_ID)
    expect(subagent).toMatchObject({ message: { content: `Read persisted output from ${targetOutput}` } })
    expect(
      JSON.parse(await readFile(join(targetResourceDir, 'subagents', 'agent-a.meta.json'), 'utf8')),
    ).toEqual({ agentType: 'general-purpose' })
  })

  it('creates a placeholder when a main-session persisted output was already removed', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    const sourceResourceDir = join(projectDir, SOURCE_ID)
    const missingOutput = join(sourceResourceDir, 'tool-results', 'missing.txt')
    await mkdir(join(sourceResourceDir, 'tool-results'), { recursive: true })
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      `${JSON.stringify({
        type: 'tool_result',
        sessionId: SOURCE_ID,
        toolUseResult: { persistedOutputPath: missingOutput },
      })}\n`,
      'utf8',
    )

    await cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })

    const targetOutput = join(projectDir, TARGET_ID, 'tool-results', 'missing.txt')
    expect(await readFile(targetOutput, 'utf8')).toContain('Historical tool output was removed')
  })

  it('creates placeholders for missing persisted outputs referenced by subagents', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    const sourceResourceDir = join(projectDir, SOURCE_ID)
    const missingOutput = join(sourceResourceDir, 'tool-results', 'missing-subagent.txt')
    await mkdir(join(sourceResourceDir, 'subagents'), { recursive: true })
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      `${JSON.stringify({ type: 'mode', sessionId: SOURCE_ID })}\n`,
      'utf8',
    )
    await writeFile(
      join(sourceResourceDir, 'subagents', 'agent-a.jsonl'),
      `${JSON.stringify({ toolUseResult: { persistedOutputPath: missingOutput } })}\n`,
      'utf8',
    )

    await cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })

    const targetOutput = join(projectDir, TARGET_ID, 'tool-results', 'missing-subagent.txt')
    expect(await readFile(targetOutput, 'utf8')).toContain('Historical tool output was removed')
  })

  it('rejects persisted outputs outside the source Session directory', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    const sourceResourceDir = join(projectDir, SOURCE_ID)
    const outsideOutput = `${sourceResourceDir}\\..\\outside.txt`
    await mkdir(sourceResourceDir, { recursive: true })
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      `${JSON.stringify({
        toolUseResult: { persistedOutputPath: outsideOutput },
      })}\n`,
      'utf8',
    )

    await expect(cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })).rejects.toThrow('escapes the source Session directory')
  })

  it('rewrites only top-level cwd values when cloning across workspaces', async () => {
    const targetCwd = 'E:\\target\\workspace'
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      `${JSON.stringify({
        type: 'user',
        sessionId: SOURCE_ID,
        cwd: CWD,
        message: { content: `Historical path: ${CWD}\\old.txt` },
      })}\n`,
      'utf8',
    )

    await cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd,
    })

    const targetProjectDir = join(configDir, 'projects', encodeClaudeProjectPath(targetCwd))
    const cloned = JSON.parse(
      (await readFile(join(targetProjectDir, `${TARGET_ID}.jsonl`), 'utf8')).trim(),
    ) as Record<string, unknown>
    expect(cloned.cwd).toBe(targetCwd)
    expect(cloned).toMatchObject({ message: { content: `Historical path: ${CWD}\\old.txt` } })
  })

  it('rejects incomplete source JSONL without leaving target artifacts', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    await mkdir(projectDir, { recursive: true })
    await writeFile(join(projectDir, `${SOURCE_ID}.jsonl`), '{"type":"user"', 'utf8')

    await expect(cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
      sourceReadAttempts: 1,
    })).rejects.toThrow('complete JSON line')

    expect(await readdir(projectDir)).toEqual([`${SOURCE_ID}.jsonl`])
  })

  it('never overwrites an existing target Session', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    await mkdir(projectDir, { recursive: true })
    await writeFile(
      join(projectDir, `${SOURCE_ID}.jsonl`),
      `${JSON.stringify({ type: 'mode', sessionId: SOURCE_ID })}\n`,
      'utf8',
    )
    await writeFile(join(projectDir, `${TARGET_ID}.jsonl`), 'existing', 'utf8')

    await expect(cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: SOURCE_ID,
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })).rejects.toThrow('already exists')
    expect(await readFile(join(projectDir, `${TARGET_ID}.jsonl`), 'utf8')).toBe('existing')
  })

  it('validates Session IDs before resolving delete targets', async () => {
    await expect(cloneClaudeSessionFiles({
      configDir,
      sourceSessionId: '../source',
      targetSessionId: TARGET_ID,
      sourceCwd: CWD,
      targetCwd: CWD,
    })).rejects.toThrow('valid UUID')
  })
})

describe('removeClaudeSessionFiles', () => {
  it('removes only the selected Session JSONL and resource directory', async () => {
    const projectDir = join(configDir, 'projects', encodeClaudeProjectPath(CWD))
    await mkdir(join(projectDir, TARGET_ID), { recursive: true })
    await writeFile(join(projectDir, `${SOURCE_ID}.jsonl`), 'source', 'utf8')
    await writeFile(join(projectDir, `${TARGET_ID}.jsonl`), 'target', 'utf8')
    await writeFile(join(projectDir, TARGET_ID, 'resource.txt'), 'resource', 'utf8')

    await removeClaudeSessionFiles({ configDir, cwd: CWD, sessionId: TARGET_ID })

    expect(await readdir(projectDir)).toEqual([`${SOURCE_ID}.jsonl`])
  })
})
