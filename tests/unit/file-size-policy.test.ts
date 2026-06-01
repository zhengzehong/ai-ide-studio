import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('file size policy', () => {
  test('TeamContextPanel stays under the frontend component line limit', () => {
    expect(lineCount('ui/src/components/team/TeamContextPanel.tsx')).toBeLessThanOrEqual(300)
  })

  test('team service stays under the backend file line limit', () => {
    expect(lineCount('src/core/teams.ts')).toBeLessThanOrEqual(400)
  })
})

function lineCount(path: string): number {
  return readFileSync(resolve(path), 'utf-8').split(/\r?\n/).length
}
