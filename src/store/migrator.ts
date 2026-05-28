import type Database from 'better-sqlite3'

export type SqliteDatabase = ReturnType<typeof Database>

export interface Migration {
  version: string
  name: string
  up: (db: SqliteDatabase) => void
}

const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`

export function runMigrations(db: SqliteDatabase, migrations: Migration[]): void {
  db.exec(MIGRATION_TABLE_SQL)

  const applied = new Set(
    db.prepare<[], { version: string }>('SELECT version FROM schema_migrations').all().map(row => row.version),
  )

  const apply = db.transaction((pending: Migration[]) => {
    const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    for (const migration of pending) {
      migration.up(db)
      record.run(migration.version, migration.name, new Date().toISOString())
    }
  })

  apply(migrations.filter(migration => !applied.has(migration.version)))
}
