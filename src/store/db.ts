import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'

interface StoreData {
  agents: Record<string, unknown>
  sessions: Record<string, unknown>
  messages: Record<string, unknown[]>
  tasks: Record<string, unknown>
  rules: Record<string, unknown>
}

let _data: StoreData | null = null
let _dbPath: string = ''
let _saveTimer: ReturnType<typeof setTimeout> | null = null

function defaultData(): StoreData {
  return { agents: {}, sessions: {}, messages: {}, tasks: {}, rules: {} }
}

export function initDatabase(dbPath: string): void {
  _dbPath = dbPath
  mkdirSync(dirname(dbPath), { recursive: true })

  if (existsSync(dbPath)) {
    try {
      const raw = readFileSync(dbPath, 'utf-8')
      _data = { ...defaultData(), ...JSON.parse(raw) }
    } catch {
      _data = defaultData()
    }
  } else {
    _data = defaultData()
    persist()
  }
}

export function getData(): StoreData {
  if (!_data) throw new Error('Database not initialized. Call initDatabase() first.')
  return _data
}

export function persist(): void {
  if (!_data || !_dbPath) return

  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    try {
      writeFileSync(_dbPath, JSON.stringify(_data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[DB] 持久化失败:', err)
    }
  }, 200)
}

export function persistSync(): void {
  if (!_data || !_dbPath) return
  writeFileSync(_dbPath, JSON.stringify(_data, null, 2), 'utf-8')
}

export function closeDatabase(): void {
  if (_saveTimer) {
    clearTimeout(_saveTimer)
    _saveTimer = null
  }
  persistSync()
  _data = null
}

export function getDbPath(): string {
  return resolve(dirname(_dbPath))
}
