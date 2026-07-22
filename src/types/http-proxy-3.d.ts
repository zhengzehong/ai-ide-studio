declare module 'http-proxy-3' {
  import type { Agent, IncomingMessage, ServerResponse } from 'node:http'
  import type { Socket } from 'node:net'
  import type { Duplex } from 'node:stream'

  export interface ProxyServerOptions {
    agent?: Agent
    changeOrigin?: boolean
    ignorePath?: boolean
    prependPath?: boolean
    ws?: boolean
    xfwd?: boolean
  }

  export interface ProxyRequestOptions {
    agent?: Agent
    target: string
  }

  export interface ProxyServer {
    on(event: 'error', listener: (error: Error, request: IncomingMessage, response: ServerResponse | Socket) => void): this
    on(event: 'econnreset', listener: (error: Error, request: IncomingMessage) => void): this
    web(
      request: IncomingMessage,
      response: ServerResponse,
      options: ProxyRequestOptions,
      callback?: (error: Error) => void,
    ): void
    ws(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      options: ProxyRequestOptions,
      callback?: (error: Error) => void,
    ): void
  }

  export function createProxyServer(options?: ProxyServerOptions): ProxyServer
}
