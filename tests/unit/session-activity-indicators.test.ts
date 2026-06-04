import { describe, expect, test } from 'vitest'
import { isRunningStage, sessionIndicator } from '../../ui/src/utils/session-indicators.ts'

describe('session activity indicators', () => {
  test('prioritizes running over unread and lifecycle status', () => {
    const session = { id: 'sess-1', status: 'active' }

    expect(sessionIndicator(session, { 'sess-1': true }, { 'sess-1': true })).toMatchObject({
      color: 'var(--green)',
      pulse: true,
      title: '正在执行',
    })
  })

  test('shows unread before ordinary active state', () => {
    const session = { id: 'sess-1', status: 'active' }

    expect(sessionIndicator(session, {}, { 'sess-1': true })).toMatchObject({
      color: 'var(--yellow)',
      pulse: false,
      title: '有新回复',
    })
  })

  test('falls back to active and closed colors', () => {
    expect(sessionIndicator({ id: 'sess-active', status: 'active' }, {}, {})).toMatchObject({
      color: 'var(--green)',
      pulse: false,
      title: '可用',
    })
    expect(sessionIndicator({ id: 'sess-closed', status: 'closed' }, {}, {})).toMatchObject({
      color: 'var(--text-3)',
      pulse: false,
      title: '已关闭',
    })
  })

  test('recognizes only known running stages as recovery fallback', () => {
    expect(isRunningStage('正在思考...')).toBe(true)
    expect(isRunningStage('正在恢复会话...')).toBe(true)
    expect(isRunningStage('生成已中断，可重新发送')).toBe(false)
    expect(isRunningStage('')).toBe(false)
  })
})
