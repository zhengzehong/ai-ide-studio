import type { Migration } from '../migrator.js'

export const taskReportStatusMigration: Migration = {
  version: '024',
  name: 'task-report-status',
  up(db) {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN agent_report_status TEXT;
    `)
  },
}
