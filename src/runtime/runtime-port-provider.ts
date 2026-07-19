import type { RuntimePort } from '../ports/runtime-port.js'
import { EmbeddedRuntimePort } from './api/embedded-runtime-port.js'

const defaultRuntimePort = new EmbeddedRuntimePort()
let activeRuntimePort: RuntimePort = defaultRuntimePort

export function setRuntimePort(port: RuntimePort): () => void {
  const previous = activeRuntimePort
  activeRuntimePort = port
  return () => {
    if (activeRuntimePort === port) activeRuntimePort = previous
  }
}

export function getRuntimePort(): RuntimePort {
  return activeRuntimePort
}

export function resetRuntimePort(): void {
  activeRuntimePort = defaultRuntimePort
}
