import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import type { DeviceJobRequest, DeviceJobResult, DeviceJobState, DeviceJobType } from '../devices/protocol.js'

export interface DeviceFile {
  serverPath: string
  size: number
  sha256: string
  expiresAt: number
}

export interface DeviceJobRow {
  id: string
  device_id: string
  project_id: string | null
  session_id: string | null
  agent_id: string | null
  type: DeviceJobType
  state: DeviceJobState
  request_json: string
  result_json: string | null
  file_id: string | null
  file_json: string | null
  created_at: string
  updated_at: string
  deadline_at: number
}

export const deviceJobStore = {
  create(input: { deviceId: string; projectId?: string; sessionId: string; agentId: string; request: DeviceJobRequest }): DeviceJobRow {
    const now = new Date().toISOString()
    const row: DeviceJobRow = {
      id: `djob-${randomUUID()}`, device_id: input.deviceId,
      project_id: input.projectId ?? null, session_id: input.sessionId, agent_id: input.agentId,
      type: input.request.type, state: 'queued', request_json: JSON.stringify(input.request),
      result_json: null, file_id: null, file_json: null, created_at: now, updated_at: now,
      deadline_at: Date.now() + input.request.timeoutSeconds * 1000,
    }
    getDb().prepare(`INSERT INTO device_jobs
      (id, device_id, project_id, session_id, agent_id, type, state, request_json, created_at, updated_at, deadline_at)
      VALUES (@id, @device_id, @project_id, @session_id, @agent_id, @type, @state, @request_json, @created_at, @updated_at, @deadline_at)`).run(row)
    return row
  },
  get(id: string): DeviceJobRow | undefined {
    return getDb().prepare<[string], DeviceJobRow>('SELECT * FROM device_jobs WHERE id = ?').get(id)
  },
  active(deviceId?: string): DeviceJobRow[] {
    return getDb().prepare<[], DeviceJobRow>(`SELECT * FROM device_jobs
      WHERE state IN ('queued','running','cancel_requested','unknown')`).all().filter((row) => !deviceId || row.device_id === deviceId)
  },
  transition(id: string, from: DeviceJobState[], state: DeviceJobState, result?: DeviceJobResult): boolean {
    return getDb().prepare(`UPDATE device_jobs SET state = ?, result_json = COALESCE(?, result_json), updated_at = ?
      WHERE id = ? AND state IN (${from.map(() => '?').join(',')})`).run(
      state, result ? JSON.stringify(result) : null, new Date().toISOString(), id, ...from,
    ).changes === 1
  },
  setFile(id: string, file: DeviceFile): string {
    const fileId = `dfile-${randomUUID()}`
    getDb().prepare('UPDATE device_jobs SET file_id = ?, file_json = ? WHERE id = ?').run(fileId, JSON.stringify(file), id)
    return fileId
  },
  findFile(fileId: string): DeviceJobRow | undefined {
    return getDb().prepare<[string], DeviceJobRow>('SELECT * FROM device_jobs WHERE file_id = ?').get(fileId)
  },
  files(): DeviceJobRow[] {
    return getDb().prepare<[], DeviceJobRow>('SELECT * FROM device_jobs WHERE file_json IS NOT NULL').all()
  },
  clearFile(id: string): void {
    getDb().prepare('UPDATE device_jobs SET file_json = NULL, file_id = NULL WHERE id = ?').run(id)
  },
}
