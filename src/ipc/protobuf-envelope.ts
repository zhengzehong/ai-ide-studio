export interface IpcEnvelope {
  version: string
  kind: string
  requestId?: string
  timestamp: number
  deadlineMs?: number
  projectId?: string
  sessionId?: string
  streamGeneration?: string
  sequence?: number
  batchId?: string
  idempotencyKey?: string
  payload: Record<string, unknown>
}

export interface IpcCodecOptions {
  maxPayloadBytes?: number
}

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
const WIRE_VARINT = 0
const WIRE_FIXED_64 = 1
const WIRE_LENGTH_DELIMITED = 2
const WIRE_FIXED_32 = 5

export function encodeIpcEnvelope(
  envelope: IpcEnvelope,
  options: IpcCodecOptions = {},
): Buffer {
  validateEnvelope(envelope)
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  const payload = Buffer.from(JSON.stringify(envelope.payload), 'utf8')
  if (payload.length > maxPayloadBytes) {
    throw new Error(`IPC payload exceeds maximum: ${payload.length} > ${maxPayloadBytes}`)
  }

  const fields: Buffer[] = [
    encodeStringField(1, envelope.version),
    encodeStringField(2, envelope.kind),
  ]
  pushString(fields, 3, envelope.requestId)
  fields.push(encodeIntegerField(4, envelope.timestamp))
  pushInteger(fields, 5, envelope.deadlineMs)
  pushString(fields, 6, envelope.projectId)
  pushString(fields, 7, envelope.sessionId)
  pushString(fields, 8, envelope.streamGeneration)
  pushInteger(fields, 9, envelope.sequence)
  pushString(fields, 10, envelope.batchId)
  pushString(fields, 11, envelope.idempotencyKey)
  fields.push(encodeBytesField(12, payload))
  return Buffer.concat(fields)
}

export function decodeIpcEnvelope(
  encoded: Uint8Array,
  options: IpcCodecOptions = {},
): IpcEnvelope {
  const input = Buffer.from(encoded)
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES
  const values: Partial<IpcEnvelope> = {}
  let payload: Record<string, unknown> | undefined
  let offset = 0

  while (offset < input.length) {
    const tag = readVarint(input, offset)
    offset = tag.offset
    const field = Number(tag.value >> 3n)
    const wire = Number(tag.value & 0x07n)

    if (field === 4 || field === 5 || field === 9) {
      requireWire(field, wire, WIRE_VARINT)
      const decoded = readVarint(input, offset)
      offset = decoded.offset
      const value = safeNumber(decoded.value, `IPC field ${field}`)
      if (field === 4) values.timestamp = value
      else if (field === 5) values.deadlineMs = value
      else values.sequence = value
      continue
    }

    if ((field >= 1 && field <= 3) || (field >= 6 && field <= 8) || field === 10 || field === 11) {
      requireWire(field, wire, WIRE_LENGTH_DELIMITED)
      const decoded = readBytes(input, offset)
      offset = decoded.offset
      const value = decoded.value.toString('utf8')
      if (field === 1) values.version = value
      else if (field === 2) values.kind = value
      else if (field === 3) values.requestId = value
      else if (field === 6) values.projectId = value
      else if (field === 7) values.sessionId = value
      else if (field === 8) values.streamGeneration = value
      else if (field === 10) values.batchId = value
      else values.idempotencyKey = value
      continue
    }

    if (field === 12) {
      requireWire(field, wire, WIRE_LENGTH_DELIMITED)
      const decoded = readBytes(input, offset)
      offset = decoded.offset
      if (decoded.value.length > maxPayloadBytes) {
        throw new Error(`IPC payload exceeds maximum: ${decoded.value.length} > ${maxPayloadBytes}`)
      }
      payload = parsePayload(decoded.value)
      continue
    }

    offset = skipUnknownField(input, offset, wire)
  }

  const result: IpcEnvelope = {
    version: values.version ?? '',
    kind: values.kind ?? '',
    timestamp: values.timestamp ?? 0,
    payload: payload ?? {},
  }
  assignOptional(result, values)
  validateEnvelope(result)
  return result
}

function validateEnvelope(envelope: IpcEnvelope): void {
  if (!envelope.version.trim()) throw new Error('IPC envelope version is required')
  if (!envelope.kind.trim()) throw new Error('IPC envelope kind is required')
  requireSafeInteger(envelope.timestamp, 'timestamp')
  if (envelope.deadlineMs !== undefined) requireSafeInteger(envelope.deadlineMs, 'deadlineMs')
  if (envelope.sequence !== undefined) requireSafeInteger(envelope.sequence, 'sequence')
  if (!isRecord(envelope.payload)) throw new Error('IPC envelope payload must be an object')
}

function assignOptional(target: IpcEnvelope, source: Partial<IpcEnvelope>): void {
  if (source.requestId !== undefined) target.requestId = source.requestId
  if (source.deadlineMs !== undefined) target.deadlineMs = source.deadlineMs
  if (source.projectId !== undefined) target.projectId = source.projectId
  if (source.sessionId !== undefined) target.sessionId = source.sessionId
  if (source.streamGeneration !== undefined) target.streamGeneration = source.streamGeneration
  if (source.sequence !== undefined) target.sequence = source.sequence
  if (source.batchId !== undefined) target.batchId = source.batchId
  if (source.idempotencyKey !== undefined) target.idempotencyKey = source.idempotencyKey
}

function encodeStringField(field: number, value: string): Buffer {
  return encodeBytesField(field, Buffer.from(value, 'utf8'))
}

function encodeBytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint(BigInt((field << 3) | WIRE_LENGTH_DELIMITED)),
    encodeVarint(BigInt(value.length)),
    value,
  ])
}

function encodeIntegerField(field: number, value: number): Buffer {
  requireSafeInteger(value, `field ${field}`)
  return Buffer.concat([
    encodeVarint(BigInt(field << 3)),
    encodeVarint(BigInt(value)),
  ])
}

function pushString(target: Buffer[], field: number, value: string | undefined): void {
  if (value !== undefined) target.push(encodeStringField(field, value))
}

function pushInteger(target: Buffer[], field: number, value: number | undefined): void {
  if (value !== undefined) target.push(encodeIntegerField(field, value))
}

function encodeVarint(value: bigint): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = Number(remaining & 0x7fn)
    remaining >>= 7n
    if (remaining > 0n) byte |= 0x80
    bytes.push(byte)
  } while (remaining > 0n)
  return Buffer.from(bytes)
}

function readVarint(input: Buffer, start: number): { value: bigint; offset: number } {
  let value = 0n
  let shift = 0n
  let offset = start
  while (offset < input.length && shift <= 63n) {
    const byte = input[offset]
    offset += 1
    value |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7n
  }
  throw new Error('Truncated or invalid protobuf varint')
}

function readBytes(input: Buffer, start: number): { value: Buffer; offset: number } {
  const length = readVarint(input, start)
  const byteLength = safeNumber(length.value, 'protobuf field length')
  const end = length.offset + byteLength
  if (end > input.length) throw new Error('Truncated protobuf field')
  return { value: input.subarray(length.offset, end), offset: end }
}

function skipUnknownField(input: Buffer, offset: number, wire: number): number {
  if (wire === WIRE_VARINT) return readVarint(input, offset).offset
  if (wire === WIRE_LENGTH_DELIMITED) return readBytes(input, offset).offset
  if (wire === WIRE_FIXED_64) return requireAvailable(input, offset, 8)
  if (wire === WIRE_FIXED_32) return requireAvailable(input, offset, 4)
  throw new Error(`Unsupported protobuf wire type: ${wire}`)
}

function requireAvailable(input: Buffer, offset: number, bytes: number): number {
  const end = offset + bytes
  if (end > input.length) throw new Error('Truncated protobuf field')
  return end
}

function requireWire(field: number, actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`Invalid wire type for IPC field ${field}`)
}

function safeNumber(value: bigint, label: string): number {
  const parsed = Number(value)
  requireSafeInteger(parsed, label)
  return parsed
}

function requireSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a safe non-negative integer`)
  }
}

function parsePayload(value: Buffer): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value.toString('utf8'))
  } catch (error) {
    throw new Error('IPC payload is not valid JSON', { cause: error })
  }
  if (!isRecord(parsed)) throw new Error('IPC envelope payload must be an object')
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
