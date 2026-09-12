import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, '.tmp/team-pending-browser')
await mkdir(output, { recursive: true })
const server = await createServer({
  root: resolve(root, 'ui'),
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, proxy: {} },
  plugins: [{ name: 'team-recovery-fixture', configureServer(vite) {
    vite.middlewares.use('/team-probe', async (_request, response) => {
      const html = '<html><head></head><body style="margin:0"><div id="root" style="height:100vh;display:flex"></div><script type="module" src="/@fs/' + resolve(root, 'tests/fixtures/team-pending-browser.tsx').replaceAll('\\', '/') + '"></script></body></html>'
      response.setHeader('Content-Type', 'text/html')
      response.end(await vite.transformIndexHtml('/team-probe', html))
    })
  } }],
})
let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.goto(`http://127.0.0.1:${address.port}/team-probe`)
  await page.locator('textarea').waitFor()
  await page.locator('textarea').fill('请安排体检')
  await page.locator('textarea').press('Enter')
  await page.getByText('正在准备 Agent...', { exact: true }).waitFor()
  assert.equal(await page.getByText('正在准备 Agent...', { exact: true }).count(), 1)
  await page.screenshot({ path: resolve(output, 'preparing.png') })

  await page.evaluate(() => window.teamProbe.progress('member'))
  await page.locator('[data-latest-process]').waitFor()
  await page.evaluate(() => { window.teamProbe.complete(false); window.teamProbe.gap() })
  await page.getByText('Master 已完成 reply-1', { exact: true }).waitFor()
  await page.getByText('正在准备 Agent...', { exact: true }).waitFor({ state: 'hidden' })
  const activity = page.getByLabel('团队成员动态')
  await activity.getByTitle('定位 Master 的最新消息').waitFor()
  await activity.getByTitle('定位 体检员 C 的最新消息').getByLabel('运行中').waitFor()
  assert.equal(await activity.getByTitle('定位 Master 的最新消息').getByLabel('运行中').count(), 0)
  assert.equal(await activity.getByTitle('定位 体检员 C 的最新消息').getByLabel('运行中').count(), 1)
  await page.screenshot({ path: resolve(output, 'recovered-desktop.png') })

  await page.locator('textarea').fill('继续下一轮')
  await page.locator('textarea').press('Enter')
  await page.getByText('正在准备 Agent...', { exact: true }).waitFor()
  await page.evaluate(() => window.teamProbe.oldDone())
  assert.equal(await page.getByText('正在准备 Agent...', { exact: true }).count(), 1)
  await page.evaluate(() => window.teamProbe.progress('master'))
  await page.getByText('正在准备 Agent...', { exact: true }).waitFor({ state: 'hidden' })
  const messagePages = await page.evaluate(() => window.teamProbe.messagePageCount())
  await page.evaluate(() => window.teamProbe.complete())
  await page.waitForFunction(previous => window.teamProbe.messagePageCount() > previous, messagePages)
  await page.getByText('Master 已完成 reply-2', { exact: true }).waitFor()
  assert.equal(await page.getByText('Master 已完成 reply-1', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Master 已完成 reply-2', { exact: true }).count(), 1)

  const before = await page.evaluate(() => window.teamProbe.recoveryCount())
  await page.evaluate(() => window.teamProbe.mount('other-conversation'))
  await page.waitForFunction(previous => window.teamProbe.recoveryCount() > previous, before)
  await page.evaluate(() => window.teamProbe.mount())
  await page.getByText('Master 已完成 reply-2', { exact: true }).waitFor()
  await page.setViewportSize({ width: 900, height: 760 })
  await page.screenshot({ path: resolve(output, 'recovered-narrow.png') })
  assert.equal(await page.locator('[role="alert"]').count(), 0)
  assert.deepEqual(errors, [])
  process.stdout.write(JSON.stringify({ result: 'passed', checks: ['single preparation label', 'PC gap recovery', 'independent member running', 'late old done preserves next input', 'stream completion retains output', 'conversation switching'], screenshots: output }) + '\n')
} finally {
  await browser?.close()
  await server.close()
}
