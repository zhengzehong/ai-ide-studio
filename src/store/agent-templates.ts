import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { createChildLogger } from '../core/logger.js'

const log = createChildLogger('store:template')

export interface AgentTemplateRow {
  id: string
  name: string
  type: string
  runtime: string
  icon: string
  system_prompt: string
  description: string | null
  skills_json: string | null
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface CreateTemplateInput {
  name: string
  type: string
  id?: string
  runtime?: string
  icon?: string
  systemPrompt?: string
  description?: string
  skills?: string[]
  isBuiltin?: boolean
}

export const templateStore = {
  create(input: CreateTemplateInput): AgentTemplateRow {
    const now = new Date().toISOString()
    const tpl: AgentTemplateRow = {
      id: input.id ?? `tpl-${randomUUID().slice(0, 8)}`,
      name: input.name,
      type: input.type,
      runtime: input.runtime ?? 'claude',
      icon: input.icon ?? 'bot',
      system_prompt: input.systemPrompt ?? '',
      description: input.description ?? null,
      skills_json: input.skills ? JSON.stringify(input.skills) : null,
      is_builtin: input.isBuiltin ? 1 : 0,
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `
      INSERT INTO agent_templates (id, name, type, runtime, icon, system_prompt, description, skills_json, is_builtin, created_at, updated_at)
      VALUES (@id, @name, @type, @runtime, @icon, @system_prompt, @description, @skills_json, @is_builtin, @created_at, @updated_at)
    `,
      )
      .run(tpl)
    log.info({ templateId: tpl.id, name: tpl.name, type: tpl.type }, 'Agent 模板已创建')
    return tpl
  },

  get(id: string): AgentTemplateRow | undefined {
    return getDb().prepare<[string], AgentTemplateRow>('SELECT * FROM agent_templates WHERE id = ?').get(id)
  },

  list(): AgentTemplateRow[] {
    return getDb()
      .prepare<[], AgentTemplateRow>('SELECT * FROM agent_templates ORDER BY is_builtin DESC, created_at ASC')
      .all()
  },

  update(id: string, fields: Partial<Omit<CreateTemplateInput, 'isBuiltin'>>): AgentTemplateRow | undefined {
    const tpl = templateStore.get(id)
    if (!tpl) return undefined

    const updated: AgentTemplateRow = {
      ...tpl,
      name: fields.name ?? tpl.name,
      type: fields.type ?? tpl.type,
      runtime: fields.runtime ?? tpl.runtime,
      icon: fields.icon ?? tpl.icon,
      system_prompt: fields.systemPrompt ?? tpl.system_prompt,
      description: fields.description !== undefined ? (fields.description ?? null) : tpl.description,
      skills_json: fields.skills ? JSON.stringify(fields.skills) : tpl.skills_json,
      updated_at: new Date().toISOString(),
    }
    getDb()
      .prepare(
        `
      UPDATE agent_templates
      SET name = @name, type = @type, runtime = @runtime, icon = @icon,
          system_prompt = @system_prompt, description = @description,
          skills_json = @skills_json, updated_at = @updated_at
      WHERE id = @id
    `,
      )
      .run(updated)
    return updated
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM agent_templates WHERE id = ?').run(id)
    log.info({ templateId: id }, 'Agent 模板已删除')
  },
}

export function seedBuiltinTemplates(): void {
  const builtins: CreateTemplateInput[] = [
    {
      id: 'tpl-architect',
      name: '架构师',
      type: 'architect',
      runtime: 'claude',
      icon: 'brain',
      description: '擅长系统设计、技术选型和方案评估',
      systemPrompt: `你是一位资深系统架构师。你的核心职责：
- 分析需求并设计系统架构
- 技术选型和方案评估（提供多个备选方案并比较优劣）
- API 设计和微服务架构规划
- 性能优化和可扩展性分析

工作方式：先充分理解需求，再给出结构化方案。始终关注可维护性、可扩展性和团队协作效率。`,
      skills: ['系统设计', 'API 设计', '技术选型', '性能分析'],
      isBuiltin: true,
    },
    {
      id: 'tpl-dev',
      name: '代码工程师',
      type: 'dev',
      runtime: 'codex',
      icon: 'code',
      description: '精通代码编写、调试和重构',
      systemPrompt: `你是一位高效的代码工程师。你的核心职责：
- 编写高质量、可维护的代码
- 调试和修复 Bug
- 代码重构和性能优化
- 遵循项目的编码规范和架构原则

工作方式：先理解上下文和约束，再动手编码。写完代码后主动运行测试验证。`,
      skills: ['代码编写', '调试', '重构', '测试'],
      isBuiltin: true,
    },
    {
      id: 'tpl-reviewer',
      name: '代码审查员',
      type: 'reviewer',
      runtime: 'claude',
      icon: 'search',
      description: '专注代码质量和最佳实践审查',
      systemPrompt: `你是一位严格的代码审查员。你的核心职责：
- 审查代码质量、可读性和可维护性
- 检查是否遵循项目编码规范
- 识别潜在的 Bug、安全漏洞和性能问题
- 提供具体、可操作的改进建议

工作方式：逐文件审查，按严重程度分类问题。优先关注正确性和安全性，其次是性能和风格。`,
      skills: ['代码审查', '安全审计', '质量检查', '最佳实践'],
      isBuiltin: true,
    },
    {
      id: 'tpl-tester',
      name: '测试工程师',
      type: 'tester',
      runtime: 'codex',
      icon: 'test-tube',
      description: '擅长测试编写和质量保障',
      systemPrompt: `你是一位测试工程师。你的核心职责：
- 编写单元测试和集成测试
- 设计测试用例（正常路径 + 边界情况 + 异常路径）
- 分析测试覆盖率并补充缺失的测试
- 编写端到端测试

工作方式：先分析待测代码的逻辑分支，设计测试矩阵，再编写测试代码。`,
      skills: ['单元测试', '集成测试', '覆盖率分析', 'E2E 测试'],
      isBuiltin: true,
    },
    {
      id: 'tpl-docs',
      name: '文档工程师',
      type: 'docs',
      runtime: 'claude',
      icon: 'file-text',
      description: '擅长技术文档和 API 文档编写',
      systemPrompt: `你是一位文档工程师。你的核心职责：
- 编写清晰、准确的技术文档
- 生成 API 文档和使用指南
- 维护项目 README 和贡献指南
- 编写架构决策记录（ADR）

工作方式：先阅读代码了解实现，再用简洁的语言描述。文档面向目标读者，避免冗余。`,
      skills: ['技术文档', 'API 文档', 'README', '架构文档'],
      isBuiltin: true,
    },
    {
      id: 'tpl-ops',
      name: 'DevOps 工程师',
      type: 'ops',
      runtime: 'codex',
      icon: 'server',
      description: '擅长 CI/CD、部署和基础设施',
      systemPrompt: `你是一位 DevOps 工程师。你的核心职责：
- 设计和维护 CI/CD 流水线
- 容器化和编排（Docker / Kubernetes）
- 监控、日志和告警配置
- 基础设施即代码（IaC）

工作方式：自动化一切可自动化的流程。关注可靠性、安全性和成本效率。`,
      skills: ['CI/CD', 'Docker', '监控', '自动化部署'],
      isBuiltin: true,
    },
    {
      id: 'tpl-team-leader',
      name: '正式 Team Leader',
      type: 'leader',
      runtime: 'claude',
      icon: 'users',
      description: '负责创建团队、招募真实成员、拆分任务、派活和闭环总结',
      systemPrompt: `你是 AI IDE Studio 的正式 Team Leader，负责把用户目标拆解成可执行的团队协作流程。

核心职责：
- 创建 Team，并根据任务需要招募真实成员。
- 为成员创建明确的 Team Task，并通过 team.member.message 派发。
- 读取成员通过 team.mailbox.send 提交的报告。
- 根据成员进展继续派活、汇总风险，并给用户输出最终结论。

协作规则：
- 创建成员时优先使用真实 runtime：codex 或 claude，不要使用 mock。
- 不要代替成员伪造 report；成员必须自己使用 team.mailbox.send 汇报，并使用 team.task.update 更新自己的任务状态。
- 成员完成、阻塞或提问后，系统会通过异步进展唤醒你；不要 sleep、不要轮询等待。
- Team 工具中的 project/team/member/session 上下文由系统补齐，不要求用户手填项目名称。
- 每一轮回复都要说明当前 Team、成员、任务状态，以及下一步是否需要等待系统唤醒。`,
      skills: ['团队编排', '任务拆解', '成员派活', '进展汇总', '闭环交付'],
      isBuiltin: true,
    },
  ]

  let created = 0
  let skipped = 0
  for (const tpl of builtins) {
    if (builtinTemplateExists(tpl)) {
      skipped += 1
      continue
    }
    templateStore.create(tpl)
    created += 1
  }
  log.info({ created, skipped, total: builtins.length }, '内置 Agent 模板已初始化')
}

function builtinTemplateExists(input: CreateTemplateInput): boolean {
  if (input.id && templateStore.get(input.id)) {
    return true
  }

  const existing = getDb()
    .prepare<[string, string, string], AgentTemplateRow>(
      'SELECT * FROM agent_templates WHERE is_builtin = 1 AND name = ? AND type = ? AND runtime = ? ORDER BY created_at ASC LIMIT 1',
    )
    .get(input.name, input.type, input.runtime ?? 'claude')

  return existing !== undefined
}
