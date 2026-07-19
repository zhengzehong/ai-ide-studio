import { describe, expect, test } from 'vitest'
import {
  ResourceGovernor,
  defaultRuntimeResourceLimits,
} from '../../src/runtime/resources/resource-governor.js'

describe('ResourceGovernor', () => {
  test('uses bounded defaults for thirty concurrent Sessions', () => {
    expect(defaultRuntimeResourceLimits(8)).toEqual({ network: 32, cpu: 4, disk: 2 })
    expect(defaultRuntimeResourceLimits(2)).toEqual({ network: 32, cpu: 2, disk: 2 })
  })

  test('wakes the oldest waiter when a resource permit is released', async () => {
    const governor = new ResourceGovernor({ network: 2, cpu: 1, disk: 1 })
    const first = await governor.acquire('network')
    const second = await governor.acquire('network')
    const order: string[] = []
    const thirdPromise = governor.acquire('network').then((lease) => {
      order.push('third')
      return lease
    })
    const fourthPromise = governor.acquire('network').then((lease) => {
      order.push('fourth')
      return lease
    })

    await Promise.resolve()
    expect(order).toEqual([])
    first.release()
    const third = await thirdPromise
    expect(order).toEqual(['third'])
    second.release()
    const fourth = await fourthPromise
    expect(order).toEqual(['third', 'fourth'])
    third.release()
    fourth.release()
  })

  test('rejects queued acquisitions during shutdown', async () => {
    const governor = new ResourceGovernor({ network: 1, cpu: 1, disk: 1 })
    const lease = await governor.acquire('cpu')
    const waiting = governor.acquire('cpu')
    governor.close()

    await expect(waiting).rejects.toThrow('Resource governor is closed')
    lease.release()
  })
})
