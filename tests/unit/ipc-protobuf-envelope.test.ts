import { describe, expect, it } from 'vitest'
import {
  decodeIpcEnvelope,
  encodeIpcEnvelope,
  type IpcEnvelope,
} from '../../src/ipc/protobuf-envelope.js'

const envelope: IpcEnvelope = {
  version: '1',
  kind: 'realtime.event',
  requestId: 'req-1',
  timestamp: 1_750_000_000_000,
  deadlineMs: 5_000,
  projectId: 'project-a',
  sessionId: 'session-a',
  streamGeneration: 'generation-a',
  sequence: 42,
  batchId: 'batch-a',
  idempotencyKey: 'idempotency-a',
  payload: { scope: 'session', nested: { delivered: true } },
}

describe('IPC protobuf envelope', () => {
  it('round-trips all architecture metadata and JSON payload', () => {
    expect(decodeIpcEnvelope(encodeIpcEnvelope(envelope))).toEqual(envelope)
  })

  it('skips unknown length-delimited fields for forward compatibility', () => {
    const encoded = encodeIpcEnvelope(envelope)
    const withUnknownField = Buffer.concat([encoded, Buffer.from([0x6a, 0x01, 0x78])])

    expect(decodeIpcEnvelope(withUnknownField)).toEqual(envelope)
  })

  it('rejects malformed, unsafe, or non-object envelopes', () => {
    expect(() => decodeIpcEnvelope(Buffer.from([0x0a, 0x05, 0x61])))
      .toThrow('Truncated protobuf field')
    expect(() => encodeIpcEnvelope({ ...envelope, sequence: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow('safe non-negative integer')
    expect(() => encodeIpcEnvelope({ ...envelope, payload: [] as unknown as Record<string, unknown> }))
      .toThrow('payload must be an object')
    expect(() => decodeIpcEnvelope(encodeIpcEnvelope({ ...envelope, version: '' })))
      .toThrow('version')
  })
})
