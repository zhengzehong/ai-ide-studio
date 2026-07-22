import type { MiddlewareHandler } from 'hono'
import { compress } from 'hono/compress'

const compressLargeResponse = compress({ encoding: 'gzip', threshold: 1024 })

export function responseCompression(): MiddlewareHandler {
  return async (context, next) => {
    const result = await compressLargeResponse(context, next)
    if (context.res.headers.has('Content-Encoding')) appendVaryAcceptEncoding(context.res.headers)
    return result
  }
}

function appendVaryAcceptEncoding(headers: Headers): void {
  const vary = headers.get('Vary')
  if (!vary) {
    headers.set('Vary', 'Accept-Encoding')
    return
  }
  const values = vary.split(',').map((value) => value.trim().toLowerCase())
  if (!values.includes('accept-encoding')) headers.set('Vary', `${vary}, Accept-Encoding`)
}
