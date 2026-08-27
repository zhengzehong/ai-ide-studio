import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('file-change API boundary', () => {
  test('keeps complete diff calculation out of API turn handling and finalization', () => {
    const turnRuntime = source('src/core/turn-process-runtime.ts')
    const sessions = source('src/core/sessions.ts')
    const sessionRpc = source('src/gateway/rpc/sessions.ts')

    expect(turnRuntime).not.toContain('buildFileChangesFromToolCalls')
    expect(sessions).not.toContain('fileChangesJsonFromToolCalls')
    expect(sessionRpc).not.toContain('buildFileChangesFromToolCalls')
    expect(turnRuntime).toContain('updateTurnFileChange')
  })
})

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}
