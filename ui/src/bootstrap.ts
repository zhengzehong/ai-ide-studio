import {
  hydrateBootstrapSnapshot,
  registerBootstrapSnapshotPersistence,
} from './project-scope/bootstrap-snapshot'
import { createZustandBootstrapBridge } from './project-scope/bootstrap-snapshot-stores'
import {
  createIndexedDbBootstrapStorage,
  type BootstrapSnapshotStorage,
} from './services/bootstrap-snapshot-storage'

export interface UiBootstrapOptions {
  storage?: BootstrapSnapshotStorage
  timeoutMs?: number
  persistenceDebounceMs?: number
}

export async function bootstrapUiData(options: UiBootstrapOptions = {}): Promise<() => void> {
  const storage = options.storage ?? createIndexedDbBootstrapStorage()
  const bridge = createZustandBootstrapBridge()
  await hydrateBootstrapSnapshot(storage, {
    bridge,
    timeoutMs: options.timeoutMs ?? 100,
  })
  return registerBootstrapSnapshotPersistence(storage, {
    bridge,
    debounceMs: options.persistenceDebounceMs ?? 500,
  })
}
