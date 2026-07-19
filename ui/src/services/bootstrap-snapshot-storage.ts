export const BOOTSTRAP_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024

const DATABASE_NAME = 'ai-ide-bootstrap'
const DATABASE_VERSION = 1
const OBJECT_STORE_NAME = 'snapshots'
const CURRENT_SNAPSHOT_KEY = 'current'

export interface BootstrapSnapshotDatabase {
  get(): Promise<string | undefined>
  put(value: string): Promise<void>
  delete(): Promise<void>
}

export interface BootstrapSnapshotStorage {
  read(): Promise<unknown | null>
  write(value: unknown): Promise<boolean>
  clear(): Promise<void>
}

export interface IndexedDbBootstrapStorageOptions {
  openDatabase?: () => Promise<BootstrapSnapshotDatabase>
  maxBytes?: number
  onError?: (error: unknown) => void
}

export function createIndexedDbBootstrapStorage(
  options: IndexedDbBootstrapStorageOptions = {},
): BootstrapSnapshotStorage {
  const openDatabase = options.openDatabase ?? openNativeBootstrapDatabase
  const maxBytes = options.maxBytes ?? BOOTSTRAP_SNAPSHOT_MAX_BYTES
  const database = lazy(openDatabase)
  let reported = false

  const report = (error: unknown): void => {
    if (reported) return
    reported = true
    options.onError?.(error)
  }

  return {
    async read(): Promise<unknown | null> {
      try {
        const serialized = await (await database()).get()
        if (serialized === undefined) return null
        if (typeof serialized !== 'string') throw new Error('IndexedDB 快照记录格式无效')
        return JSON.parse(serialized) as unknown
      } catch (error) {
        report(error)
        return null
      }
    },

    async write(value: unknown): Promise<boolean> {
      try {
        const serialized = JSON.stringify(value)
        if (new TextEncoder().encode(serialized).byteLength > maxBytes) return false
        await (await database()).put(serialized)
        return true
      } catch (error) {
        report(error)
        return false
      }
    },

    async clear(): Promise<void> {
      try {
        await (await database()).delete()
      } catch (error) {
        report(error)
      }
    },
  }
}

export async function openNativeBootstrapDatabase(): Promise<BootstrapSnapshotDatabase> {
  const factory = indexedDbFactory()
  const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) db.createObjectStore(OBJECT_STORE_NAME)
  }
  const db = await requestResult(request)
  return {
    get(): Promise<string | undefined> {
      const transaction = db.transaction(OBJECT_STORE_NAME, 'readonly')
      return requestResult<string | undefined>(
        transaction.objectStore(OBJECT_STORE_NAME).get(CURRENT_SNAPSHOT_KEY),
      )
    },
    async put(value: string): Promise<void> {
      const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite')
      transaction.objectStore(OBJECT_STORE_NAME).put(value, CURRENT_SNAPSHOT_KEY)
      await transactionComplete(transaction)
    },
    async delete(): Promise<void> {
      const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite')
      transaction.objectStore(OBJECT_STORE_NAME).delete(CURRENT_SNAPSHOT_KEY)
      await transactionComplete(transaction)
    },
  }
}

function indexedDbFactory(): IDBFactory {
  const factory = globalThis.indexedDB
  if (!factory) throw new Error('IndexedDB 不可用')
  return factory
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB 事务已中止'))
  })
}

function lazy<T>(factory: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined
  return () => {
    value ??= factory()
    return value
  }
}
