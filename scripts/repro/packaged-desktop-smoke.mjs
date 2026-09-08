import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const isolated = await mkdtemp(join(tmpdir(), 'studio-package-smoke-'))
const userData = join(isolated, 'profile')
const executablePath = resolve(process.argv[2] || 'release/win-unpacked/AI IDE Studio.exe')
const screenshot = resolve('data/package-review/first-run.png')
await mkdir(resolve('data/package-review'), { recursive: true })
const env = { ...process.env, APPDATA: isolated, LOCALAPPDATA: isolated, LOG_DIR: join(isolated, 'logs') }
delete env.ELECTRON_RUN_AS_NODE
const application = await electron.launch({ executablePath, args: [`--user-data-dir=${userData}`], env, timeout: 30_000 })
try {
  const actual = await application.evaluate(({ app }) => ({ userData: app.getPath('userData'), packaged: app.isPackaged }))
  assert.equal(actual.userData.toLowerCase(), userData.toLowerCase())
  assert.equal(actual.packaged, true)
  const window = await application.firstWindow()
  await window.getByRole('heading', { name: '连接 AI IDE Studio' }).waitFor()
  assert.equal(await window.evaluate(() => typeof window.electronSetup?.submit), 'function')
  await window.getByRole('radio').nth(1).check()
  await window.locator('#origin').waitFor({ state: 'visible' })
  await window.screenshot({ path: screenshot })
  process.stdout.write(JSON.stringify({ executablePath, ...actual, preload: 'ok', remoteForm: 'ok', screenshot }) + '\n')
} finally {
  await application.close()
}
