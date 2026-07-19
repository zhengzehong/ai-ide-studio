import type {
  DatabaseMaintenanceConfig,
  RuntimeCommandInput,
  RuntimeCommandUpdate,
  WriteBatch,
  WriteBatchResult,
  WriteDataPort,
} from '../../ports/write-data-port.js'
import {
  enqueueRuntimeCommand,
  executeWriteBatches,
  listRecoverableRuntimeCommands,
  readSessionWriteCursor,
  updateRuntimeCommand,
} from '../../data-worker/writer-worker/operations.js'
import { maintainWriterDatabase } from '../../data-worker/writer-worker/maintenance.js'
import { getDb } from '../../store/db.js'

export function createLocalWriteDataPort(maintenanceConfig: DatabaseMaintenanceConfig = {}): WriteDataPort {
  return {
    async commitBatch(batch: WriteBatch): Promise<WriteBatchResult> {
      return executeWriteBatches(getDb(), [batch])[0]
    },
    async sessionCursor(sessionId: string) {
      return readSessionWriteCursor(getDb(), sessionId)
    },
    async enqueueRuntimeCommand(input: RuntimeCommandInput) {
      return enqueueRuntimeCommand(getDb(), input)
    },
    async listRecoverableRuntimeCommands(limit: number) {
      return listRecoverableRuntimeCommands(getDb(), limit)
    },
    async updateRuntimeCommand(input: RuntimeCommandUpdate) {
      return updateRuntimeCommand(getDb(), input)
    },
    async maintain(input) {
      return maintainWriterDatabase(getDb(), input, maintenanceConfig)
    },
    async drain(): Promise<void> {
      // Local better-sqlite3 mutations complete before commitBatch returns.
    },
    async close(): Promise<void> {
      // The legacy database lifecycle remains owned by store/db.
    },
  }
}

export const localWriteDataPort = createLocalWriteDataPort()
