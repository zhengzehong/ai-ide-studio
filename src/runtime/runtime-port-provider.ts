import type { RuntimePort } from '../ports/runtime-port.js'

let activeRuntimePort: RuntimePort | undefined

export function setRuntimePort(port: RuntimePort): void {
  activeRuntimePort = port
}

export function getRuntimePort(): RuntimePort {
  if (!activeRuntimePort) throw new Error('Runtime port is not initialized')
  return activeRuntimePort
}

export function resetRuntimePort(): void {
  activeRuntimePort = undefined
}
