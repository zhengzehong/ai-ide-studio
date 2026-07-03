// DB 验证脚本:在临时 DB 上跑全部 migration,验证 033 agent-hub-connections 表已创建且 schema_migrations 含 033。
// 用法: npx tsx scripts/verify-migration-033.ts
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runMigrations } from '../src/store/migrator.js'
import { migrations } from '../src/store/migrations/index.js'

const tmpDir = mkdtempSync(join(tmpdir(), 'migration-verify-'))
const dbPath = join(tmpDir, 'verify.db')

try {
  const db = new Database(dbPath)
  runMigrations(db, migrations)

  const versions = db.prepare<[], { version: string; name: string }>(
    'SELECT version, name FROM schema_migrations ORDER BY version',
  ).all()
  console.log('schema_migrations:')
  for (const v of versions) console.log(`  ${v.version} ${v.name}`)

  const has033 = versions.some(v => v.version === '033' && v.name === 'agent-hub-connections')
  console.log(`\n033 agent-hub-connections applied: ${has033}`)

  const tables = db.prepare<[], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_hub_connections'",
  ).all()
  console.log(`agent_hub_connections table exists: ${tables.length > 0}`)

  if (tables.length > 0) {
    const schema = db.prepare<[], { sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_hub_connections'",
    ).get()
    console.log('\nagent_hub_connections schema:')
    console.log(schema.sql)

    const indexes = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_hub_connections'",
    ).all()
    console.log('\nindexes:')
    for (const idx of indexes) console.log(`  ${idx.name}`)
  }

  db.close()
  console.log(`\nverify result: ${has033 && tables.length > 0 ? 'PASS' : 'FAIL'}`)
  process.exit(has033 && tables.length > 0 ? 0 : 1)
} finally {
  rmSync(tmpDir, { recursive: true, force: true })
}
