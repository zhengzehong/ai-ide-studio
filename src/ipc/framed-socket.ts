import { decodeIpcEnvelope, encodeIpcEnvelope, type IpcEnvelope } from './protobuf-envelope.js'

export interface FramedDuplex {
  readonly destroyed: boolean
  write(chunk: Uint8Array): boolean
  end(callback?: () => void): unknown
  destroy(error?: Error): unknown
  on(event: string, listener: (...args: never[]) => void): unknown
  off(event: string, listener: (...args: never[]) => void): unknown
}

export interface FramedSocketOptions {
  maxFrameBytes: number
}

type MessageListener = (message: IpcEnvelope) => void
type ErrorListener = (error: Error) => void

export class LengthPrefixedFrameDecoder {
  private buffered = Buffer.alloc(0)

  constructor(private readonly maxFrameBytes: number) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1) {
      throw new Error('maxFrameBytes must be a positive integer')
    }
  }

  push(chunk: Uint8Array): Buffer[] {
    if (chunk.byteLength > 0) {
      this.buffered = this.buffered.length === 0
        ? Buffer.from(chunk)
        : Buffer.concat([this.buffered, Buffer.from(chunk)])
    }
    const frames: Buffer[] = []
    while (this.buffered.length >= 4) {
      const length = this.buffered.readUInt32BE(0)
      if (length > this.maxFrameBytes) {
        throw new Error(`IPC frame exceeds maximum: ${length} > ${this.maxFrameBytes}`)
      }
      if (this.buffered.length < length + 4) break
      frames.push(this.buffered.subarray(4, length + 4))
      this.buffered = this.buffered.subarray(length + 4)
    }
    return frames
  }
}

export class FramedSocket {
  private readonly decoder: LengthPrefixedFrameDecoder
  private readonly messageListeners = new Set<MessageListener>()
  private readonly errorListeners = new Set<ErrorListener>()
  private writeChain: Promise<void> = Promise.resolve()
  private state: 'open' | 'closing' | 'closed' = 'open'
  private closePromise?: Promise<void>

  constructor(
    private readonly socket: FramedDuplex,
    private readonly options: FramedSocketOptions,
  ) {
    this.decoder = new LengthPrefixedFrameDecoder(options.maxFrameBytes)
    socket.on('data', this.handleData as (...args: never[]) => void)
    socket.on('error', this.handleError as (...args: never[]) => void)
    socket.on('close', this.handleClose as (...args: never[]) => void)
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  send(message: IpcEnvelope): Promise<void> {
    if (this.state !== 'open') return Promise.reject(new Error('IPC framed socket is closed'))
    const payload = encodeIpcEnvelope(message, { maxPayloadBytes: this.options.maxFrameBytes })
    if (payload.length > this.options.maxFrameBytes) {
      return Promise.reject(new Error(`IPC frame exceeds maximum: ${payload.length} > ${this.options.maxFrameBytes}`))
    }
    const header = Buffer.allocUnsafe(4)
    header.writeUInt32BE(payload.length)
    const frame = Buffer.concat([header, payload])
    const operation = this.writeChain.then(() => this.writeFrame(frame))
    this.writeChain = operation.catch(() => undefined)
    return operation
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    if (this.state === 'closed') return Promise.resolve()
    this.state = 'closing'
    this.closePromise = this.writeChain
      .catch(() => undefined)
      .then(() => this.endSocket())
      .finally(() => this.markClosed())
    return this.closePromise
  }

  private writeFrame(frame: Buffer): Promise<void> {
    if (this.state === 'closed' || this.socket.destroyed) {
      return Promise.reject(new Error('IPC framed socket is closed'))
    }
    if (this.socket.write(frame)) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const onDrain = (): void => {
        cleanup()
        resolve()
      }
      const onClose = (): void => {
        cleanup()
        reject(new Error('IPC framed socket closed before drain'))
      }
      const onError = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const cleanup = (): void => {
        this.socket.off('drain', onDrain as (...args: never[]) => void)
        this.socket.off('close', onClose as (...args: never[]) => void)
        this.socket.off('error', onError as (...args: never[]) => void)
      }
      this.socket.on('drain', onDrain as (...args: never[]) => void)
      this.socket.on('close', onClose as (...args: never[]) => void)
      this.socket.on('error', onError as (...args: never[]) => void)
    })
  }

  private endSocket(): Promise<void> {
    if (this.socket.destroyed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.socket.end(resolve)
    })
  }

  private readonly handleData = (chunk: Buffer): void => {
    try {
      for (const frame of this.decoder.push(chunk)) {
        const message = decodeIpcEnvelope(frame, { maxPayloadBytes: this.options.maxFrameBytes })
        for (const listener of this.messageListeners) listener(message)
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      this.emitError(normalized)
      this.socket.destroy(normalized)
    }
  }

  private readonly handleError = (error: Error): void => {
    this.emitError(error)
  }

  private readonly handleClose = (): void => {
    this.markClosed()
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) listener(error)
  }

  private markClosed(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.socket.off('data', this.handleData as (...args: never[]) => void)
    this.socket.off('error', this.handleError as (...args: never[]) => void)
    this.socket.off('close', this.handleClose as (...args: never[]) => void)
  }
}
