import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { closeDatabase, initDatabase } from '../../src/store/db.js'
import { projectStore } from '../../src/store/projects.js'
import { agentStore } from '../../src/store/agents.js'
import { agentMemoryService, AGENT_MEMORY_MAX_DIMENSIONS, AGENT_MEMORY_MAX_PINNED } from '../../src/core/agent-memory.js'
import { getHandler } from '../../src/tools/handlers/index.js'
import type { ToolContext, ToolHandlerResult } from '../../src/tools/types.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-agent-memory-'))
  initDatabase(resolve(tmp, 'ai-ide.sqlite'))
})

afterEach(() => {
  closeDatabase()
  rmSync(tmp, { recursive: true, force: true })
})

describe('agent memory FTS recall', () => {
  test('FTS5 bm25 hits Chinese keywords and ranks by matched-word count', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId,
      agentId,
      name: '经验库',
      description: '经验方法',
      prompt: '何时记录: ...',
    })
    const e1 = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '退款接口错误处理',
      content: '退款接口用 Result<T,E> 模式,不抛异常。涉及支付与错误处理。',
      tags: ['支付', '错误处理'],
    })
    const e2 = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '并发退款重复扣款',
      content: '## 问题\n并发退款导致重复扣款\n\n## 根因\n退款接口未加锁',
      tags: ['支付', '并发'],
    })
    const e3 = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '幂等性检查',
      content: '所有写接口必须有幂等 key,支付接口尤其重要。',
      tags: ['支付', 'api'],
    })

    const result = await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['退款', '错误'] },
      { projectId, agentId },
    )
    const ids = (result.entries as Array<{ id: string }>).map((e) => e.id)
    expect(ids[0]).toBe(e1.id)
    expect(ids).toContain(e2.id)
    expect(ids.length).toBeGreaterThanOrEqual(2)

    const e1matched = (result.entries as Array<{ matched_keywords?: string[] }>).find((e) => e.id === e1.id)
    expect(e1matched?.matched_keywords?.sort()).toEqual(['退款', '错误'])
  })

  test('2-char short keywords fall back to LIKE', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: 'TS strict mode',
      content: '所有 TS 文件开 strict mode',
      tags: ['ts', '配置'],
    })
    agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '不用 any',
      content: '避免 any,用 unknown 替代',
      tags: ['ts'],
    })

    const result = await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['TS'] },
      { projectId, agentId },
    )
    const ids = (result.entries as Array<{ id: string }>).map((e) => e.id)
    expect(ids.length).toBe(2)
  })

  test('English FTS hit and multi-word OR merge', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const e4 = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: 'TS strict mode',
      content: 'typescript strict mode catches bugs',
      tags: ['ts'],
    })
    agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: 'async await',
      content: 'use async/await for concurrency',
      tags: ['ts'],
    })

    const single = await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['strict'] },
      { projectId, agentId },
    )
    expect((single.entries as Array<{ id: string }>)[0].id).toBe(e4.id)

    const multi = await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['strict', 'typescript'] },
      { projectId, agentId },
    )
    const top = (multi.entries as Array<{ id: string; matched_keywords?: string[] }>)[0]
    expect(top.id).toBe(e4.id)
    expect(top.matched_keywords?.length).toBe(2)
  })

  test('soft-deleted entries are excluded from recall and list', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '时区 bug',
      content: '存时间统一用 UTC,展示转本地',
      tags: ['时间'],
    })
    agentMemoryService.deleteEntry({ projectId, agentId, entryId: e.id })

    const recall = await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['时区'] },
      { projectId, agentId },
    )
    expect(recall.entries).toEqual([])

    const list = await executeJson('list_memory',
      { dimension: '经验库' },
      { projectId, agentId },
    )
    expect(list.entries).toEqual([])
  })

  test('recall increments use_count and updates last_used_at', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '大表加列流程',
      content: '千万级大表加 NOT NULL 列会锁表',
      tags: ['db'],
    })

    await executeJson('recall_memory',
      { dimension: '经验库', keywords: ['大表', '锁表'] },
      { projectId, agentId },
    )
    const full = agentMemoryService.getEntry(projectId, agentId, e.id)
    expect(full.use_count).toBe(1)
    expect(full.last_used_at).not.toBeNull()
  })
})

describe('agent memory permission and limits', () => {
  test('rejects cross-project agent access', async () => {
    const projectA = projectStore.create({ name: 'A', workDir: resolve(tmp, 'a') })
    const projectB = projectStore.create({ name: 'B', workDir: resolve(tmp, 'b') })
    const agentA = agentStore.create({ name: 'A', type: 'dev', runtime: 'mock', projectId: projectA.id })

    expect(() =>
      agentMemoryService.listDimensions(projectB.id, agentA.id),
    ).toThrow('PROJECT_MISMATCH')
  })

  test('enforces pinned ≤ 20 limit', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '用户偏好', description: '', prompt: '',
    })
    for (let i = 0; i < AGENT_MEMORY_MAX_PINNED; i++) {
      const e = agentMemoryService.recordEntry({
        projectId, agentId, dimension: '用户偏好',
        title: `pinned-${i}`, content: `content-${i}`, tags: [],
      })
      agentMemoryService.setPinned({ projectId, agentId, entryId: e.id, pinned: true })
    }
    const overflow = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '用户偏好',
      title: 'overflow', content: 'should fail to pin', tags: [],
    })
    expect(() =>
      agentMemoryService.setPinned({ projectId, agentId, entryId: overflow.id, pinned: true }),
    ).toThrow('PINNED_LIMIT_EXCEEDED')
  })

  test('update_memory tool handler can pin and unpin', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '用户偏好', description: '', prompt: '',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '用户偏好',
      title: '驼峰命名', content: '用户偏好驼峰命名', tags: ['命名'],
    })

    const pinned = await executeJson('update_memory',
      { entry_id: e.id, pinned: true },
      { projectId, agentId },
    )
    expect((pinned.entry as { pinned: boolean }).pinned).toBe(true)

    const unpinned = await executeJson('update_memory',
      { entry_id: e.id, pinned: false },
      { projectId, agentId },
    )
    expect((unpinned.entry as { pinned: boolean }).pinned).toBe(false)
  })

  test('get_memory returns full markdown content', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const md = '## 问题\n并发退款\n\n## 方案\n- 加锁\n- 幂等 key'
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '并发退款', content: md, tags: ['支付'],
    })

    const result = await executeJson('get_memory',
      { entry_id: e.id },
      { projectId, agentId },
    )
    expect((result.entry as { content: string }).content).toBe(md)
    expect((result.entry as { dimension_name: string }).dimension_name).toBe('经验库')
  })
})

describe('agent memory system prompt injection', () => {
  test('buildAgentMemoryPrompt includes dimensions + pinned entries', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '用户偏好',
      description: '用户偏好', prompt: '何时记录: 用户表达偏好时',
    })
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库',
      description: '经验方法', prompt: '何时记录: 解决非平凡问题后',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '用户偏好',
      title: '驼峰命名', content: '用户偏好驼峰命名', tags: [],
      confidence: 1.0,
    })
    agentMemoryService.setPinned({ projectId, agentId, entryId: e.id, pinned: true })

    const prompt = agentMemoryService.buildAgentMemoryPrompt(agentId)
    expect(prompt).toContain('## 你的 Agent 记忆')
    expect(prompt).toContain('维度: 用户偏好')
    expect(prompt).toContain('维度: 经验库')
    expect(prompt).toContain('recall_memory')
    expect(prompt).toContain('[用户偏好] 驼峰命名')
    expect(prompt).toContain('define_memory_dimension')
  })

  test('returns empty string when agent has no dimensions', () => {
    const { agentId } = setupAgent()
    expect(agentMemoryService.buildAgentMemoryPrompt(agentId)).toBe('')
  })

  test('pinned entries below confidence 0.7 are not injected', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const low = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '低置信度', content: '不确定的结论', tags: [],
      confidence: 0.5,
    })
    agentMemoryService.setPinned({ projectId, agentId, entryId: low.id, pinned: true })

    const prompt = agentMemoryService.buildAgentMemoryPrompt(agentId)
    expect(prompt).not.toContain('低置信度')
  })
})

describe('agent memory inject_full (全文注入)', () => {
  test('开启 inject_full 自动置顶;关闭置顶自动关闭 inject_full', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '团队成员名单', content: 'Alice, Bob, Carol', tags: [],
      confidence: 0.95,
    })

    const injected = agentMemoryService.updateEntry({
      projectId, agentId, entryId: e.id, injectFull: true,
    })
    expect(injected.pinned).toBe(true)
    expect(injected.inject_full).toBe(true)

    const unpinned = agentMemoryService.updateEntry({
      projectId, agentId, entryId: e.id, pinned: false,
    })
    expect(unpinned.pinned).toBe(false)
    expect(unpinned.inject_full).toBe(false)
  })

  test('inject_full 要求 confidence ≥ 0.9,不达标报错', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '低置信度', content: 'x', tags: [],
      confidence: 0.7,
    })
    expect(() =>
      agentMemoryService.updateEntry({ projectId, agentId, entryId: e.id, injectFull: true }),
    ).toThrow('INJECT_FULL_MIN_CONFIDENCE')
  })

  test('inject_full 要求 content ≤ 1500 字,超出报错', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    const longContent = 'x'.repeat(1501)
    const e = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '长内容', content: longContent, tags: [],
      confidence: 0.95,
    })
    expect(() =>
      agentMemoryService.updateEntry({ projectId, agentId, entryId: e.id, injectFull: true }),
    ).toThrow('INJECT_FULL_MAX_CONTENT_LENGTH')
  })

  test('inject_full 上限 3 条,第 4 条报错', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '经验库', description: '', prompt: '',
    })
    for (let i = 0; i < 3; i++) {
      const e = agentMemoryService.recordEntry({
        projectId, agentId, dimension: '经验库',
        title: `条目${i}`, content: `内容${i}`, tags: [],
        confidence: 0.95,
      })
      agentMemoryService.updateEntry({ projectId, agentId, entryId: e.id, injectFull: true })
    }
    const fourth = agentMemoryService.recordEntry({
      projectId, agentId, dimension: '经验库',
      title: '第4条', content: '内容4', tags: [],
      confidence: 0.95,
    })
    expect(() =>
      agentMemoryService.updateEntry({ projectId, agentId, entryId: fourth.id, injectFull: true }),
    ).toThrow('INJECT_FULL_LIMIT_EXCEEDED')
  })

  test('buildAgentMemoryPrompt 含"核心记忆(全文注入)"段 + content 全文 + "索引"段', () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: 'facts', description: '', prompt: '',
    })
    const injectContent = '## 团队\n- Alice: PM\n- Bob: 后端\n- Carol: 设计'
    const injectEntry = agentMemoryService.recordEntry({
      projectId, agentId, dimension: 'facts',
      title: '团队成员', content: injectContent, tags: [],
      confidence: 0.95,
    })
    agentMemoryService.updateEntry({ projectId, agentId, entryId: injectEntry.id, injectFull: true })

    const pinnedOnly = agentMemoryService.recordEntry({
      projectId, agentId, dimension: 'facts',
      title: '仅置顶条目', content: '不该出现在全文段', tags: [],
      confidence: 0.9,
    })
    agentMemoryService.updateEntry({ projectId, agentId, entryId: pinnedOnly.id, pinned: true })

    const prompt = agentMemoryService.buildAgentMemoryPrompt(agentId)
    expect(prompt).toContain('### 核心记忆（全文注入）')
    expect(prompt).toContain('[facts] 团队成员')
    expect(prompt).toContain(injectContent)
    expect(prompt).toContain('### 索引')
    expect(prompt).toContain('[facts] 仅置顶条目')
    expect(prompt).not.toContain('不该出现在全文段')
  })
})

describe('agent memory define_memory_dimension tool', () => {
  test('define_memory_dimension succeeds and returns dimension_id + name', async () => {
    const { agentId, projectId } = setupAgent()
    const result = await executeJson('define_memory_dimension',
      {
        name: '协作习惯',
        description: '用户交互风格偏好',
        prompt: '何时记录: 用户纠正协作方式时\n何时使用: 会话开始时 recall',
      },
      { projectId, agentId },
    )
    expect(result.dimension_id).toBeTruthy()
    expect(result.name).toBe('协作习惯')

    const dims = agentMemoryService.listDimensions(projectId, agentId)
    expect(dims.find((d) => d.name === '协作习惯')).toBeTruthy()
  })

  test('define_memory_dimension rejects duplicate name', async () => {
    const { agentId, projectId } = setupAgent()
    agentMemoryService.createDimension({
      projectId, agentId, name: '用户偏好', description: '已有', prompt: '',
    })

    await expect(
      executeJson('define_memory_dimension',
        { name: '用户偏好', description: '冲突', prompt: 'xxx' },
        { projectId, agentId },
      ),
    ).rejects.toThrow('维度已存在')
  })

  test('define_memory_dimension rejects when agent has 10 dimensions', async () => {
    const { agentId, projectId } = setupAgent()
    for (let i = 0; i < AGENT_MEMORY_MAX_DIMENSIONS; i++) {
      agentMemoryService.createDimension({
        projectId, agentId, name: `维度${i}`, description: '', prompt: '',
      })
    }

    await expect(
      executeJson('define_memory_dimension',
        { name: '第11个', description: '超限', prompt: 'xxx' },
        { projectId, agentId },
      ),
    ).rejects.toThrow('DIMENSION_LIMIT_EXCEEDED')
  })
})

function setupAgent(): { agentId: string; projectId: string } {
  const project = projectStore.create({ name: 'AI IDE', workDir: tmp })
  const agent = agentStore.create({ name: 'Agent A', type: 'dev', runtime: 'mock', projectId: project.id })
  return { agentId: agent.id, projectId: project.id }
}

async function executeJson(
  handlerName: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = getHandler(handlerName)
  if (!handler) throw new Error(`handler missing: ${handlerName}`)
  const result: ToolHandlerResult = await handler.execute(input, context)
  expect(result.isError).not.toBe(true)
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>
}
