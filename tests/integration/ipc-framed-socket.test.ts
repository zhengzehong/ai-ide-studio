import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  FramedSocket,
  LengthPrefixedFrameDecoder,
  type FramedDuplex,
} from '../../src/ipc/framed-socket.js'
import {
  encodeIpcEnvelope,
  type IpcEnvelope,
} from '../../src/ipc/protobuf-envelope.js'

const message: IpcEnvelope = {
  version: '1',
  kind: 'test.message',
  requestId: 'request-a',
  timestamp: 123,
  payload: { value: 'hello' },
}

describe('length-prefixed IPC socket', () => {
  it('decodes split headers/bodies and multiple frames from one chunk', () => {
    const decoder = new LengthPrefixedFrameDecoder(1024)
    const first = frame(Buffer.from('first'))
    const second = frame(Buffer.from('second'))

    expect(decoder.push(first.subarray(0, 2))).toEqual([])
    expect(decoder.push(first.subarray(2, 7))).toEqual([])
    expect(decoder.push(Buffer.concat([first.subarray(7), second])))
      .toEqual([Buffer.from('first'), Buffer.from('second')])
  })

  it('rejects a declared frame above the configured maximum', () => {
    const decoder = new LengthPrefixedFrameDecoder(4)
    const header = Buffer.alloc(4)
    header.writeUInt32BE(5)

    expect(() => decoder.push(header)).toThrow('exceeds maximum')
  })

  it('waits for drain after socket backpressure and rejects sends after close', async () => {
    const socket = new FakeDuplex()
    socket.acceptWrites = false
    const transport = new FramedSocket(socket, { maxFrameBytes: 4096 })
    let settled = false

    const send = transport.send(message).then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    socket.emit('drain')
    await send
    expect(settled).toBe(true)
    expect(socket.write).toHaveBeenCalledOnce()

    await transport.close()
    await expect(transport.close()).resolves.toBeUndefined()
    await expect(transport.send(message)).rejects.toThrow('closed')
  })

  it('emits decoded envelopes received from the duplex', async () => {
    const socket = new FakeDuplex()
    const transport = new FramedSocket(socket, { maxFrameBytes: 4096 })
    const received = new Promise<IpcEnvelope>((resolve) => transport.onMessage(resolve))

    socket.emit('data', frameFromEnvelope(message))

    await expect(received).resolves.toEqual(message)
    await transport.close()
  })
})

class FakeDuplex extends EventEmitter implements FramedDuplex {
  acceptWrites = true
  destroyed = false
  write = vi.fn((_chunk: Uint8Array): boolean => this.acceptWrites)

  end(callback?: () => void): this {
    callback?.()
    this.emit('close')
    return this
  }

  destroy(): this {
    this.destroyed = true
    this.emit('close')
    return this
  }
}

function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, payload])
}

function frameFromEnvelope(value: IpcEnvelope): Buffer {
  return frame(encodeIpcEnvelope(value))
}
