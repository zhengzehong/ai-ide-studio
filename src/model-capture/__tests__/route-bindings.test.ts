import { afterEach, beforeEach, expect, test } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { activateCaptureRoutes, acquireCaptureRoute, describeCaptureRoute, retainCaptureRoute } from '../route-bindings.js'
import { RuntimeCaptureBindings, spawnWithCaptureBinding } from '../runtime-bindings.js'

let deactivate: () => void
const connection = {
  agentId: 'agent-a', runtime: 'claude', profileId: 'profile-a', providerId: 'provider-a',
  protocol: 'claude', baseUrl: 'http://localhost:19000', apiKey: 'test-key', providerName: 'test',
}
beforeEach(() => { deactivate = activateCaptureRoutes(19001) })
afterEach(() => { deactivate() })

test('description is stable without registering; startup, Runtime and HTTP leases release independently', () => {
  const binding = describeCaptureRoute(connection)!
  expect(describeCaptureRoute({ ...connection })).toEqual(binding)
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
  const owner = new RuntimeCaptureBindings()
  owner.beginRequest('ensure', binding)
  owner.agentStatus({ agentId: connection.agentId, status: 'running', captureBindingId: binding.id })
  owner.endRequest('ensure')
  const request = acquireCaptureRoute(binding.id)!
  expect(request.binding.apiKey).toBe('test-key')
  owner.agentStatus({ agentId: connection.agentId, status: 'standby', captureBindingId: binding.id })
  const stillInFlight = acquireCaptureRoute(binding.id)!
  expect(stillInFlight).toBeDefined()
  stillInFlight.release()
  request.release()
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
})

test('old and queued new connections coexist; stale stop cannot release the new binding', () => {
  const old = describeCaptureRoute(connection)!
  const next = describeCaptureRoute({ ...connection, baseUrl: 'http://localhost:19002', apiKey: 'new' })!
  const owner = new RuntimeCaptureBindings()
  owner.beginRequest('old', old)
  owner.agentStatus({ agentId: connection.agentId, status: 'running', captureBindingId: old.id })
  owner.endRequest('old')
  owner.beginRequest('new', next)
  const active = acquireCaptureRoute(old.id)!
  expect(active.binding.apiKey).toBe('test-key')
  active.release()
  owner.agentStatus({ agentId: connection.agentId, status: 'standby', captureBindingId: old.id })
  owner.agentStatus({ agentId: connection.agentId, status: 'running', captureBindingId: next.id })
  owner.endRequest('new')
  owner.agentStatus({ agentId: connection.agentId, status: 'standby', captureBindingId: old.id })
  const current = acquireCaptureRoute(next.id)!
  expect(current.binding.apiKey).toBe('new')
  current.release()
  expect(acquireCaptureRoute(old.id)).toBeUndefined()
  owner.clear()
  expect(acquireCaptureRoute(next.id)).toBeUndefined()
})

test('failed startup and process exit release pending leases, including timed-out callers', () => {
  const binding = describeCaptureRoute(connection)!
  const owner = new RuntimeCaptureBindings()
  owner.beginRequest('failed', binding)
  owner.endRequest('failed')
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
  owner.beginRequest('timed-out-but-running', binding)
  const pending = acquireCaptureRoute(binding.id)!
  expect(pending).toBeDefined()
  pending.release()
  owner.clear()
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
})

test('embedded child exit/spawn failure release only their own references', () => {
  const binding = describeCaptureRoute(connection)!
  const child = new EventEmitter() as ChildProcess
  spawnWithCaptureBinding(binding, () => child)
  const nextRelease = retainCaptureRoute(binding)
  child.emit('exit', 0)
  child.emit('error', new Error('late event'))
  const lease = acquireCaptureRoute(binding.id)!
  expect(lease).toBeDefined()
  lease.release()
  nextRelease()
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
  expect(() => spawnWithCaptureBinding(binding, () => { throw new Error('spawn failed') })).toThrow('spawn failed')
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
})

test('descriptor mutation cannot alter a retained connection; closing proxy discards credentials', () => {
  const binding = describeCaptureRoute(connection)!
  const release = retainCaptureRoute(binding)
  binding.apiKey = 'mutated'
  const lease = acquireCaptureRoute(binding.id)!
  expect(lease.binding.apiKey).toBe('test-key')
  deactivate()
  expect(acquireCaptureRoute(binding.id)).toBeUndefined()
  lease.release()
  release()
})
