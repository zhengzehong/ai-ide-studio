import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

export function detectNodeShells(): Partial<Record<'powershell' | 'pwsh', string>> {
  if (process.platform !== 'win32') return {}
  const shells: Partial<Record<'powershell' | 'pwsh', string>> = {}
  const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (existsSync(powershell)) shells.powershell = powershell
  const result = spawnSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
  const pwsh = result.stdout?.trim().split(/\r?\n/).find((path) => existsSync(path))
  if (pwsh) shells.pwsh = pwsh
  return shells
}

export function powerShellScript(command: string, encoding: 'utf8' | 'gb18030' = 'utf8'): string {
  const consoleEncoding = encoding === 'gb18030' ? '[System.Text.Encoding]::GetEncoding(54936)' : 'New-Object System.Text.UTF8Encoding($false)'
  const script = `[Console]::OutputEncoding = ${consoleEncoding}\n$OutputEncoding = [Console]::OutputEncoding\n$ErrorActionPreference = 'Stop'\ntry {\n${command}\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }\n} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }`
  return '\uFEFF' + script
}

export function killOwnedProcessTree(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => { child.kill(); resolve(false) }, 5000)
    child.on('error', () => { clearTimeout(timer); resolve(false) })
    child.on('exit', (code) => { clearTimeout(timer); resolve(code === 0) })
  })
}
