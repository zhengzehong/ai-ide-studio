import { createChildLogger } from './logger.js'

const log = createChildLogger('advisor-rounds')
interface AdvisorRound {
  projectId: string
  advisorSessionId: string
  triggerSessionId: string
  submitted: boolean
}
const rounds = new Map<string, AdvisorRound>()

export function registerAdvisorRound(roundId: string, round: Omit<AdvisorRound, 'submitted'>): void {
  rounds.set(roundId, { ...round, submitted: false })
}

export function requireAdvisorRound(roundId: string, projectId: string, sessionId: string): AdvisorRound {
  const round = rounds.get(roundId)
  if (!round || round.submitted || round.projectId !== projectId || round.advisorSessionId !== sessionId) {
    throw new Error('参谋批次已结束或不属于当前会话，请使用本轮提供的 roundId')
  }
  return round
}

export function markAdvisorRoundSubmitted(roundId: string): void {
  const round = rounds.get(roundId)
  if (round) round.submitted = true
}

export function finishAdvisorRound(roundId: string): void {
  const round = rounds.get(roundId)
  if (round && !round.submitted) {
    log.warn({ roundId, projectId: round.projectId, advisorSessionId: round.advisorSessionId }, '参谋完成但未提交建议或沉默结果')
  }
  rounds.delete(roundId)
}

export function finishAdvisorRoundsForSession(sessionId: string): void {
  for (const [id, round] of rounds) {
    if (round.advisorSessionId === sessionId) finishAdvisorRound(id)
  }
}

export function invalidateAdvisorRounds(sessionId: string): void {
  for (const [id, round] of rounds) if (round.advisorSessionId === sessionId) rounds.delete(id)
}
