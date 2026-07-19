import type { WriteDataPort } from '../../ports/write-data-port.js'
import { localWriteDataPort } from './local-write-data-port.js'

let configuredWriteDataPort: WriteDataPort = localWriteDataPort

export function getWriteDataPort(): WriteDataPort {
  return configuredWriteDataPort
}

export function setWriteDataPort(writeDataPort: WriteDataPort): () => void {
  const previous = configuredWriteDataPort
  configuredWriteDataPort = writeDataPort
  return () => {
    if (configuredWriteDataPort === writeDataPort) configuredWriteDataPort = previous
  }
}
