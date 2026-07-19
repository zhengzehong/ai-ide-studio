import type {
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
import { getDb } from '../../store/db.js'

export const localWriteDataPort: WriteDataPort = {
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
  async drain(): Promise<void> {
    // Local better-sqlite3 mutations complete before commitBatch returns.
  },
  async close(): Promise<void> {
    // The legacy database lifecycle remains owned by store/db.
  },
}
