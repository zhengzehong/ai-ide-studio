import { createChildLogger } from '../core/logger.js'
import type { WriteDataPort } from '../ports/write-data-port.js'

const log = createChildLogger('writer-maintenance')

export const DEFAULT_WRITER_MAINTENANCE_INTERVAL_MS = 60_000

export interface WriterMaintenanceLoop {
  stop(): void
}

export function startWriterMaintenanceLoop(
  writeDataPort: WriteDataPort,
  intervalMs = DEFAULT_WRITER_MAINTENANCE_INTERVAL_MS,
): WriterMaintenanceLoop {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void writeDataPort
      .maintain({ force: false })
      .then(
        (result) => log.debug(result, 'Writer database maintenance completed'),
        (err) => log.warn({ err }, 'Writer database maintenance failed'),
      )
      .finally(() => {
        running = false
      })
  }, intervalMs)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
