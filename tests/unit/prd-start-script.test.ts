import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = join(process.cwd(), 'scripts', 'start-prd-local.ps1')

function readScript(): string {
  return readFileSync(scriptPath, 'utf8')
}

describe('PRD local start script', () => {
  it('builds fresh assets before starting the local instance', () => {
    const script = readScript()

    expect(script).toContain('npm run build')
    expect(script.indexOf('npm run build')).toBeLessThan(script.indexOf('npm start'))
  })

  it('replaces an existing listener on the selected PRD port', () => {
    const script = readScript()

    expect(script).toContain('Stop-Process')
    expect(script).toContain('-ErrorAction Stop')
    expect(script).toContain('Close the original start window')
    expect(script).not.toContain('ERROR: port $($env:PORT) is already in use')
  })

  it('waits for the selected PRD port to be released before failing', () => {
    const script = readScript()

    expect(script).toContain('for ($attempt = 0; $attempt -lt 20; $attempt++)')
    expect(script).toContain('Start-Sleep -Milliseconds 500')
  })
})
