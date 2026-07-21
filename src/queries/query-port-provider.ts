import type { QueryPort } from '../ports/query-port.js'
import { localQueryPort } from './local-query-port.js'

let configuredQueryPort: QueryPort = localQueryPort

export function getQueryPort(): QueryPort {
  return configuredQueryPort
}

export function setQueryPort(queryPort: QueryPort): () => void {
  const previous = configuredQueryPort
  configuredQueryPort = queryPort
  return () => {
    if (configuredQueryPort === queryPort) configuredQueryPort = previous
  }
}
