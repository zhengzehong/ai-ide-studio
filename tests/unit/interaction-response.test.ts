import { describe, expect, test } from 'vitest'
import { interactionResponseFailure } from '../../ui/src/stores/interaction-response.ts'

describe('interaction response errors', () => {
  test('uses elicitation wording for an expired elicitation', () => {
    expect(interactionResponseFailure(new Error('提问请求已失效'), 'elicitation')).toEqual({
      expired: true,
      message: '提问请求已失效，请重新发送消息',
    })
  })
})
