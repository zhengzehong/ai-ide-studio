import type { KnowledgeActivityRow, KnowledgeActorType } from '../store/knowledge-activities.js'
import type { KnowledgeBaseKind, KnowledgeBaseRow, KnowledgeBaseSource } from '../store/knowledge-bases.js'
import type { KnowledgePageRow } from '../store/knowledge-pages.js'

export interface KnowledgeLink {
  text: string
  kbId: string | null
  pageId: string | null
  title: string
  status: 'resolved' | 'missing' | 'ambiguous' | 'invisible'
}

export interface KnowledgeBacklink {
  kbId: string
  pageId: string
  title: string
}

export interface KnowledgeReadResult {
  kb: KnowledgeBaseRow
  page: KnowledgePageRow
  outLinks: KnowledgeLink[]
  backlinks: KnowledgeBacklink[]
}

export interface KnowledgeWriteActor {
  actor: string
  actorType?: KnowledgeActorType
  tool: string
  note?: string | null
}

export interface CreateKnowledgeBaseServiceInput extends KnowledgeWriteActor {
  name: string
  kind: KnowledgeBaseKind
  src: KnowledgeBaseSource
  projectId?: string | null
  icon?: string | null
  description?: string | null
}

export interface CreateKnowledgePageServiceInput extends KnowledgeWriteActor {
  projectId: string
  kbId: string
  title: string
  section?: string | null
  summary?: string | null
  body: string
  tags?: string[]
  srcFiles?: string[]
  isIndex?: boolean
}

export interface UpdateKnowledgePageServiceInput extends KnowledgeWriteActor {
  projectId: string
  pageId: string
  title?: string
  section?: string | null
  summary?: string | null
  body: string
  tags?: string[]
}

export interface RefreshKnowledgePageInput extends KnowledgeWriteActor {
  projectId: string
  pageId: string
  body: string
  srcFiles?: string[]
  confirmOverwriteHumanEdit?: boolean
}

export type KnowledgeActivityAction = KnowledgeActivityRow['act']
