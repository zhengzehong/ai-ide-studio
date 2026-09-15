import type Database from 'better-sqlite3'
import { createChildLogger } from '../core/logger.js'

export type SqliteDatabase = ReturnType<typeof Database>

export interface Migration {
  version: string
  name: string
  up: (db: SqliteDatabase) => void
}

export interface AppliedMigration {
  version: string
  name: string
  elapsedMs: number
}

const log = createChildLogger('migrator')

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`

/**
 * 应用未执行的迁移。返回本轮实际应用的迁移及各自耗时(info 级落盘),
 * 用于定位"启动慢在迁移"这类问题(9.31GB 库上单条 CREATE INDEX 可达数十秒)。
 */
export function runMigrations(db: SqliteDatabase, migrations: Migration[]): AppliedMigration[] {
  db.exec(MIGRATION_TABLE_SQL)

  const applied = new Set(
    db.prepare<[], { version: string }>('SELECT version FROM schema_migrations').all().map(row => row.version),
  )

  const pending = migrations.filter(migration => !applied.has(migration.version))
  if (pending.length === 0) return []

  const results: AppliedMigration[] = []
  const apply = db.transaction((items: Migration[]) => {
    const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    for (const migration of items) {
      const startedAt = performance.now()
      migration.up(db)
      record.run(migration.version, migration.name, new Date().toISOString())
      const elapsedMs = Math.round((performance.now() - startedAt) * 1000) / 1000
      results.push({ version: migration.version, name: migration.name, elapsedMs })
      log.info({ version: migration.version, name: migration.name, elapsedMs }, '数据库迁移已应用')
    }
  })

  apply(pending)
  return results
}
