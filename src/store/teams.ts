import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import { teamIdentityTransitionStore } from './team-identity-transition.js'

export interface TeamRow {
  id: string
  project_id: string
  name: string
  description: string | null
  master_prompt: string
  status: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface TeamMemberRow {
  id: string
  team_id: string
  project_id: string
  agent_id: string
  session_id: string
  name: string
  role: string
  model_profile_id: string | null
  model_profile_mode: string | null
  system_prompt_override: string | null
  /** 成员级默认思考强度（migration 072）：NULL=跟随模型档案/系统默认；懒生效（下一回合咬合）。 */
  reasoning_effort: string | null
  status: string
  created_at: string
  updated_at: string
}

export interface TeamMailboxRow {
  id: string
  team_id: string
  project_id: string
  from_member_id: string | null
  to_member_id: string | null
  task_id: string | null
  type: string
  content: string
  payload_json: string | null
  created_at: string
  /** 会话线归属（migration 075）；NULL = 迁移前的遗留行，读取时按"归属缺省"只在团队默认线可见。 */
  conversation_id: string | null
}

export interface TeamEventRow {
  id: string
  team_id: string
  type: string
  payload_json: string
  sequence: number
  created_at: string
}

export interface CreateTeamInput {
  projectId: string
  name: string
  description?: string
  masterPrompt?: string
}

export interface UpdateTeamInput {
  name?: string
  description?: string | null
  masterPrompt?: string
  status?: string
}

export interface CreateTeamMemberInput {
  teamId: string
  projectId: string
  agentId: string
  sessionId: string
  name: string
  role?: string
  modelProfileId?: string
  modelProfileMode?: 'inherit' | 'fixed' | 'system'
  systemPromptOverride?: string
}

export interface UpdateTeamMemberConfigInput {
  modelProfileMode?: 'inherit' | 'fixed' | 'system'
  modelProfileId?: string | null
  systemPromptOverride?: string | null
  /** 成员级默认档位：字符串=设置，null=清空（跟随档案）。P0 仅 RPC 通道就绪，UI 写入属 P1。 */
  reasoningEffort?: string | null
}

export interface CreateTeamMailboxInput {
  teamId: string
  projectId: string
  fromMemberId?: string
  toMemberId?: string
  taskId?: string
  type: string
  content: string
  payload?: unknown
  /** 会话线归属：由 core/team-line-scope.ts 四级兜底解析后传入；只有迁移前的遗留数据/测试直写为 NULL。 */
  conversationId?: string
}

/** 线内可见范围：目标线 + 团队默认线（遗留 NULL 行的归属线）。 */
export interface MailboxLineFilter {
  conversationId: string
  defaultConversationId: string | null
}

export interface AppendTeamEventInput {
  type: string
  payload: unknown
}

export const teamStore = {
  create(input: CreateTeamInput): TeamRow {
    const now = new Date().toISOString()
    const team: TeamRow = {
      id: `team-${randomUUID().slice(0, 8)}`,
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? null,
      master_prompt: input.masterPrompt ?? '',
      status: 'active',
      created_at: now,
      updated_at: now,
      archived_at: null,
    }
    getDb().prepare(`
      INSERT INTO teams (id, project_id, name, description, master_prompt, status, created_at, updated_at, archived_at)
      VALUES (@id, @project_id, @name, @description, @master_prompt, @status, @created_at, @updated_at, @archived_at)
    `).run(team)
    teamEventStore.append(team.id, { type: 'team.created', payload: { team } })
    return team
  },

  get(id: string): TeamRow | undefined {
    return getDb().prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?').get(id)
  },

  list(projectId?: string): TeamRow[] {
    if (projectId) {
      return getDb().prepare<[string], TeamRow>(`
        SELECT * FROM teams
        WHERE project_id = ? AND archived_at IS NULL
        ORDER BY updated_at DESC
      `).all(projectId)
    }
    return getDb().prepare<[], TeamRow>('SELECT * FROM teams WHERE archived_at IS NULL ORDER BY updated_at DESC').all()
  },

  update(id: string, fields: UpdateTeamInput): TeamRow | undefined {
    const existing = teamStore.get(id)
    if (!existing) return undefined
    const updated: TeamRow = {
      ...existing,
      name: fields.name ?? existing.name,
      description: fields.description !== undefined ? fields.description : existing.description,
      master_prompt: fields.masterPrompt !== undefined ? fields.masterPrompt : existing.master_prompt,
      status: fields.status ?? existing.status,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE teams
      SET name = @name, description = @description, master_prompt = @master_prompt, status = @status, updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    teamEventStore.append(id, { type: 'team.updated', payload: { team: updated } })
    return updated
  },

  /** 软删除：写 archived_at 后 teams.list 不再返回；数据保留供审计/恢复。 */
  archive(id: string): TeamRow | undefined {
    const existing = teamStore.get(id)
    if (!existing) return undefined
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE teams
      SET archived_at = @now, status = 'archived', updated_at = @now
      WHERE id = @id AND archived_at IS NULL
    `).run({ id, now })
    const archived = teamStore.get(id)
    if (archived) teamEventStore.append(id, { type: 'team.archived', payload: { team: archived } })
    return archived
  },
}

export const teamMemberStore = {
  create(input: CreateTeamMemberInput): TeamMemberRow {
    const now = new Date().toISOString()
    const row = getDb().prepare<[string, string], TeamMemberRow>(`
      SELECT * FROM team_members
      WHERE team_id = ? AND agent_id = ?
    `).get(input.teamId, input.agentId)
    if (row && row.status !== 'removed') throw new Error('Agent 已经是该 Team 成员')
    const member: TeamMemberRow = {
      id: row?.id ?? `tm-${randomUUID().slice(0, 8)}`,
      team_id: input.teamId,
      project_id: input.projectId,
      agent_id: input.agentId,
      session_id: input.sessionId,
      name: input.name,
      role: input.role ?? 'member',
      model_profile_id: input.modelProfileId ?? null,
      model_profile_mode: input.modelProfileMode ?? (input.modelProfileId ? 'fixed' : 'inherit'),
      system_prompt_override: input.systemPromptOverride ?? null,
      reasoning_effort: null,
      status: 'active',
      created_at: row?.created_at ?? now,
      updated_at: now,
    }
    if (row) {
      // (team_id, agent_id) 唯一：重新添加 = 复活被移除的关系行，历史行 id 不变。
      getDb().prepare(`
        UPDATE team_members
        SET session_id = @session_id, name = @name, role = @role, model_profile_id = @model_profile_id,
            model_profile_mode = @model_profile_mode, system_prompt_override = @system_prompt_override,
            status = 'active', updated_at = @updated_at
        WHERE id = @id
      `).run(member)
    } else {
      getDb().prepare(`
        INSERT INTO team_members (
          id, team_id, project_id, agent_id, session_id, name, role, model_profile_id, model_profile_mode, system_prompt_override, status, created_at, updated_at
        )
        VALUES (
          @id, @team_id, @project_id, @agent_id, @session_id, @name, @role, @model_profile_id, @model_profile_mode, @system_prompt_override, @status, @created_at, @updated_at
        )
      `).run(member)
    }
    teamEventStore.append(input.teamId, { type: 'member.created', payload: { member } })
    return member
  },

  get(id: string): TeamMemberRow | undefined {
    return getDb().prepare<[string], TeamMemberRow>('SELECT * FROM team_members WHERE id = ?').get(id)
  },

  getBySession(sessionId: string): TeamMemberRow | undefined {
    const direct = getDb().prepare<[string], TeamMemberRow>('SELECT * FROM team_members WHERE session_id = ?').get(sessionId)
    if (direct) return direct
    const grid = getDb().prepare<[string], TeamMemberRow>(`SELECT tm.*, tcm.session_id AS session_id
      FROM team_conversation_members tcm JOIN team_members tm ON tm.id = tcm.member_id
      WHERE tcm.session_id = ? AND tcm.left_at IS NULL LIMIT 1`).get(sessionId)
    if (grid) return grid
    const history = teamIdentityTransitionStore.history(sessionId)
    return history ? teamMemberStore.get(history.member_id) : undefined
  },

  list(teamId: string): TeamMemberRow[] {
    return getDb().prepare<[string], TeamMemberRow>(`
      SELECT * FROM team_members
      WHERE team_id = ? AND status != 'removed'
      ORDER BY created_at ASC
    `).all(teamId)
  },

  /** 全量成员（含已移除）：供会话线聚合保留已移除成员的历史消息。 */
  listAll(teamId: string): TeamMemberRow[] {
    return getDb().prepare<[string], TeamMemberRow>(`
      SELECT * FROM team_members
      WHERE team_id = ?
      ORDER BY created_at ASC
    `).all(teamId)
  },

  /** 成员级配置（模型策略/档案/系统提示词/默认档位）：仅改团队关系数据，保存后下一轮对话生效。 */
  updateConfig(id: string, input: UpdateTeamMemberConfigInput): TeamMemberRow | undefined {
    const existing = teamMemberStore.get(id)
    if (!existing) return undefined
    const updated: TeamMemberRow = {
      ...existing,
      model_profile_mode: input.modelProfileMode ?? existing.model_profile_mode,
      model_profile_id: input.modelProfileId !== undefined ? input.modelProfileId : existing.model_profile_id,
      system_prompt_override: input.systemPromptOverride !== undefined ? input.systemPromptOverride : existing.system_prompt_override,
      reasoning_effort: input.reasoningEffort !== undefined ? input.reasoningEffort : existing.reasoning_effort,
      updated_at: new Date().toISOString(),
    }
    getDb().prepare(`
      UPDATE team_members
      SET model_profile_mode = @model_profile_mode, model_profile_id = @model_profile_id,
          system_prompt_override = @system_prompt_override, reasoning_effort = @reasoning_effort,
          updated_at = @updated_at
      WHERE id = @id
    `).run(updated)
    teamEventStore.append(existing.team_id, { type: 'member.config_updated', payload: { member: updated } })
    return updated
  },

  /** 软删除：移除团队关系（status='removed'），不删项目 Agent、不删历史消息，之后可重新添加。 */
  remove(id: string): TeamMemberRow | undefined {
    const existing = teamMemberStore.get(id)
    if (!existing || existing.status === 'removed') return undefined
    const now = new Date().toISOString()
    getDb().prepare(`
      UPDATE team_members
      SET status = 'removed', updated_at = @now
      WHERE id = @id AND status != 'removed'
    `).run({ id, now })
    const removed = teamMemberStore.get(id)
    if (removed) teamEventStore.append(existing.team_id, { type: 'member.removed', payload: { member: removed } })
    return removed
  },
}

export const teamMailboxStore = {
  create(input: CreateTeamMailboxInput): TeamMailboxRow {
    const msg: TeamMailboxRow = {
      id: `tmail-${randomUUID().slice(0, 8)}`,
      team_id: input.teamId,
      project_id: input.projectId,
      from_member_id: input.fromMemberId ?? null,
      to_member_id: input.toMemberId ?? null,
      task_id: input.taskId ?? null,
      type: input.type,
      content: input.content,
      payload_json: input.payload === undefined ? null : JSON.stringify(input.payload),
      created_at: new Date().toISOString(),
      conversation_id: input.conversationId ?? null,
    }
    getDb().prepare(`
      INSERT INTO team_mailbox (
        id, team_id, project_id, from_member_id, to_member_id, task_id, type, content, payload_json, created_at, conversation_id
      )
      VALUES (
        @id, @team_id, @project_id, @from_member_id, @to_member_id, @task_id, @type, @content, @payload_json, @created_at, @conversation_id
      )
    `).run(msg)
    teamEventStore.append(input.teamId, { type: 'mailbox.created', payload: { message: msg } })
    return msg
  },

  /** 全量（人的视野：UI 团队面板）。agent 工具视图必须走 listForLine。 */
  list(teamId: string, limit = 50): TeamMailboxRow[] {
    return getDb().prepare<{ teamId: string; limit: number }, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE team_id = @teamId
      ORDER BY created_at DESC, rowid DESC
      LIMIT @limit
    `).all({ teamId, limit }).reverse()
  },

  /** 单线视图（agent 的工具视野）：本线邮件 + 归属缺省行（仅在查询默认线时可见）。 */
  listForLine(teamId: string, line: MailboxLineFilter, limit = 50): TeamMailboxRow[] {
    return getDb().prepare<MailboxLineFilter & { teamId: string; limit: number }, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE team_id = @teamId AND ${MAILBOX_LINE_SCOPE_SQL}
      ORDER BY created_at DESC, rowid DESC
      LIMIT @limit
    `).all({ ...line, teamId, limit }).reverse()
  },

  /**
   * 该成员最后一条"唤醒级"mailbox（口径见 isWakeEligibleMailbox）；没有则 null。
   * 传 line 时为线内口径（agent 的 team.status）：他线的汇报不参与本线"最后汇报"判定。
   */
  latestFromMember(teamId: string, memberId: string, line?: MailboxLineFilter): TeamMailboxRow | null {
    const scope = line ? ` AND ${MAILBOX_LINE_SCOPE_SQL}` : ''
    return getDb().prepare<{ teamId: string; memberId: string } & Partial<MailboxLineFilter>, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE team_id = @teamId AND from_member_id = @memberId AND ${WAKE_ELIGIBLE_MAILBOX_SQL}${scope}
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get({ ...(line ?? {}), teamId, memberId }) ?? null
  },

  /** 某任务最近的 N 条 mailbox（唤醒 prompt 末尾的"相关邮件摘要"用），时间升序返回。 */
  /**
   * 某任务最近的 N 条 mailbox（唤醒 prompt 末尾的"相关邮件摘要"用），时间升序返回。
   * 传 line 时为**线内口径**：同一 taskId 被多条线引用时，快照只取本线邮件（v3 复审 F2）；
   * 遗留 NULL 行按"归属缺省"只在默认线可见，与读取口径一致。
   */
  listByTask(taskId: string, limit = 3, line?: MailboxLineFilter): TeamMailboxRow[] {
    const scope = line ? ` AND ${MAILBOX_LINE_SCOPE_SQL}` : ''
    return getDb().prepare<{ taskId: string; limit: number } & Partial<MailboxLineFilter>, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE task_id = @taskId${scope}
      ORDER BY created_at DESC, rowid DESC
      LIMIT @limit
    `).all({ ...(line ?? {}), taskId, limit }).reverse()
  },

  /** 该成员在时间窗内写过的全部 mailbox（静默回合判定"本回合有没有汇报"用，时间窗起点 = 回合 human 消息时间戳）。 */
  listByMemberSince(teamId: string, memberId: string, sinceIso: string): TeamMailboxRow[] {
    return getDb().prepare<{ teamId: string; memberId: string; since: string }, TeamMailboxRow>(`
      SELECT * FROM team_mailbox
      WHERE team_id = @teamId AND from_member_id = @memberId AND created_at >= @since
      ORDER BY created_at ASC
    `).all({ teamId, memberId, since: sinceIso })
  },
}

/**
 * 线内可见口径（命名参数 @conversationId / @defaultConversationId 由调用方提供）：
 * 本线邮件 + 归属缺省（遗留 NULL 行）仅当查询的正是默认线——同一条 tmail 不可能同时出现在两条线。
 */
export const MAILBOX_LINE_SCOPE_SQL = '(conversation_id = @conversationId OR (conversation_id IS NULL AND @conversationId = @defaultConversationId))'

/** 唤醒级 mailbox 口径（与 team-wake-coordinator 的唤醒白名单一致，改一处必须改两处会被等价性测试拦住）。 */
export const WAKE_ELIGIBLE_MAILBOX_SQL = `(type IN ('report', 'result', 'question', 'blocked') OR (type = 'message' AND task_id IS NOT NULL))`

export function isWakeEligibleMailbox(message: Pick<TeamMailboxRow, 'type' | 'task_id'>): boolean {
  return WAKE_MAILBOX_TYPES.has(message.type)
    || (Boolean(message.task_id) && message.type === 'message')
}

const WAKE_MAILBOX_TYPES = new Set(['report', 'result', 'question', 'blocked'])

export const teamEventStore = {
  append(teamId: string, input: AppendTeamEventInput): TeamEventRow {
    const db = getDb()
    const last = db.prepare<[string], { sequence: number }>(`
      SELECT sequence FROM team_events
      WHERE team_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(teamId)
    const event: TeamEventRow = {
      id: `teamevt-${randomUUID().slice(0, 8)}`,
      team_id: teamId,
      type: input.type,
      payload_json: JSON.stringify(input.payload),
      sequence: (last?.sequence ?? 0) + 1,
      created_at: new Date().toISOString(),
    }
    db.prepare(`
      INSERT INTO team_events (id, team_id, type, payload_json, sequence, created_at)
      VALUES (@id, @team_id, @type, @payload_json, @sequence, @created_at)
    `).run(event)
    return event
  },

  list(teamId: string, limit = 100): TeamEventRow[] {
    return getDb().prepare<{ teamId: string; limit: number }, TeamEventRow>(`
      SELECT * FROM team_events
      WHERE team_id = @teamId
      ORDER BY sequence DESC
      LIMIT @limit
    `).all({ teamId, limit }).reverse()
  },
}
