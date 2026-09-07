import { createHash } from 'node:crypto'
import type { Migration } from '../migrator.js'

// Exact defaults from 31b8664, 100a2f7, e9a8480, 5fe8369 and 4543f98.
const LEGACY_DEFAULT_HASHES = new Set([
  'c77de06cd42b4fc9f3b330c4cf3af4f16ccb920e711904b5965b34e24bfc3831',
  'e873252c62ce45ff5b120c20a887ef9b0b7efc51d133a43fad9747903f54dbec',
  '52d89b409950e8f8e3e24c3fe0896bead46e1fb3c4b9410d54522d2200271790',
  'd502d1446d2ff7b2def0a1b1fe8e67b3836cf5f36084c90ae535622ec571a4c1',
  'bb0290e2cd95bd9bd3a27c655545cb0b8fdc84be36886ee35df94d4fc945a8fa',
])

export const advisorDefaultPromptMigration: Migration = {
  version: '064',
  name: 'advisor-default-prompt-reference',
  up(db): void {
    const rows = db.prepare<[], { project_id: string; advisor_prompt: string }>(
      'SELECT project_id, advisor_prompt FROM project_advisors',
    ).all()
    const backup = db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
    const reset = db.prepare("UPDATE project_advisors SET advisor_prompt = '' WHERE project_id = ? AND advisor_prompt = ?")
    for (const row of rows) {
      const hash = createHash('sha256').update(row.advisor_prompt.replace(/\r\n/g, '\n').trim()).digest('hex')
      if (!LEGACY_DEFAULT_HASHES.has(hash)) continue
      backup.run(`advisor_prompt_backup:064:${row.project_id}`, row.advisor_prompt, new Date().toISOString())
      reset.run(row.project_id, row.advisor_prompt)
    }
  },
}
