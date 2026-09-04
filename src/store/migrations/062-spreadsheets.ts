import type { Migration } from '../migrator.js'

/** 062：表格功能（完全独立版）——spreadsheets + spreadsheet_records（方案 §1.2） */
export const spreadsheetsMigration: Migration = {
  version: '062',
  name: 'spreadsheets',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS spreadsheets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        title TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        view_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, name),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS spreadsheet_records (
        id TEXT PRIMARY KEY,
        spreadsheet_id TEXT NOT NULL,
        data_json TEXT NOT NULL,
        sort REAL NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (spreadsheet_id) REFERENCES spreadsheets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_records_sheet
        ON spreadsheet_records(spreadsheet_id, sort);
    `)
  },
}
