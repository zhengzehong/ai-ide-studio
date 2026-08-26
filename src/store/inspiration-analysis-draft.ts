import type { CreateCandidateInput } from './inspiration-candidates.js'

export interface InspirationAnalysisDraft {
  expectedRevision: number
  summary?: string
  bodyMarkdown?: string
  questions?: string[]
  candidates?: CreateCandidateInput[]
}

export function readInspirationDraft(value: string | null, expectedRevision: number): InspirationAnalysisDraft | null {
  if (!value) return null
  try {
    const draft = JSON.parse(value) as unknown
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null
    const row = draft as Record<string, unknown>
    return row.expectedRevision === expectedRevision ? { expectedRevision } : null
  } catch {
    return null
  }
}

export function parseCompleteInspirationDraft(
  value: string | null,
  expectedRevision: number,
): Required<Pick<InspirationAnalysisDraft, 'summary' | 'bodyMarkdown' | 'questions' | 'candidates'>> | null {
  if (!value) return null
  try {
    const row = JSON.parse(value) as Record<string, unknown>
    if (row.expectedRevision !== expectedRevision
      || typeof row.summary !== 'string' || row.summary.trim().length < 8
      || typeof row.bodyMarkdown !== 'string' || row.bodyMarkdown.trim().length < 80
      || !Array.isArray(row.questions) || !Array.isArray(row.candidates)) return null
    return {
      summary: row.summary,
      bodyMarkdown: row.bodyMarkdown,
      questions: parseQuestions(row.questions),
      candidates: parseCandidates(row.candidates),
    }
  } catch {
    return null
  }
}

function parseQuestions(value: unknown[]): string[] {
  if (!value.every((item) => typeof item === 'string')) throw new Error('Invalid inspiration questions draft')
  return value
}

function parseCandidates(value: unknown[]): CreateCandidateInput[] {
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid inspiration candidate draft')
    const row = item as Record<string, unknown>
    if (typeof row.title !== 'string' || !row.title.trim()
      || typeof row.descriptionMarkdown !== 'string' || !row.descriptionMarkdown.trim()
      || (row.suggestedAgentId != null && typeof row.suggestedAgentId !== 'string')
      || (row.agentReason != null && typeof row.agentReason !== 'string')) {
      throw new Error('Invalid inspiration candidate draft')
    }
    return {
      title: row.title,
      descriptionMarkdown: row.descriptionMarkdown,
      suggestedAgentId: row.suggestedAgentId as string | null | undefined,
      agentReason: row.agentReason as string | undefined,
    }
  })
}
