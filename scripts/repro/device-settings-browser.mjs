import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright'

const root = resolve('ui')
const output = resolve('data/device-review')
await mkdir(output, { recursive: true })
const server = await createServer({ root, configFile: false, plugins: [react(), {
  name: 'isolated-device-review',
  configureServer(vite) {
    vite.middlewares.use('/__device-review', async (_req, res) => {
      const html = '<html lang="zh"><meta charset="UTF-8"><div id="root" style="max-width:900px;margin:24px auto;padding:16px"></div><script type="module">import React from "react"; import {createRoot} from "react-dom/client"; import "/src/index.css"; import {DeviceSection} from "/src/pages/settings/DeviceSection.tsx"; createRoot(document.getElementById("root")).render(React.createElement(DeviceSection));</script></html>'
      res.setHeader('Content-Type', 'text/html')
      res.end(await vite.transformIndexHtml('/__device-review', html))
    })
  },
}], server: { host: '127.0.0.1', port: 0 } })
await server.listen()
const address = server.httpServer.address()
const origin = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    let enabled = true
    const status = () => ({ supported: true, enabled, online: enabled, machineName: '当前办公电脑', deviceId: 'pc-1', shells: ['powershell'] })
    window.electronDesktop = { getSettings: async () => ({}), testConnection: async () => ({}), saveSettings: async () => ({}),
      getNodeStatus: async () => status(), setNodeEnabled: async (next) => { enabled = next; return status() }, unpairNode: async () => status() }
  })
  let state = 'data'
  await page.route('**/api/**', async (route) => {
    assert.match(route.request().url(), /\/api\/v1\/devices/)
    if (state === 'error') return route.fulfill({ status: 503, json: { error: '设备服务暂不可用' } })
    if (state === 'loading') await new Promise((r) => setTimeout(r, 600))
    return route.fulfill({ json: { devices: state === 'empty' ? [] : [
      { deviceId: 'pc-1', machineName: '当前办公电脑', online: true, enabled: true, shells: ['powershell'] },
      { deviceId: 'pc-2', machineName: '离线测试电脑', online: false, enabled: false, shells: ['powershell', 'pwsh'] },
    ] } })
  })
  await page.goto(`${origin}/__device-review`)
  await page.getByRole('button', { name: '解除 离线测试电脑 配对' }).waitFor()
  for (const [name, width, height] of [['desktop', 1360, 900], ['narrow', 390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true })
  }
  await page.getByRole('checkbox', { name: '允许远程访问' }).uncheck()
  assert.equal(await page.getByRole('checkbox', { name: '允许远程访问' }).isChecked(), false)
  state = 'error'
  await page.getByRole('button', { name: '刷新设备' }).click()
  await page.getByRole('alert').filter({ hasText: '设备服务暂不可用' }).waitFor()
  state = 'empty'
  await page.getByRole('button', { name: '刷新设备' }).click()
  await page.getByText('暂无已配对电脑').waitFor()
  state = 'loading'
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText('正在加载设备').waitFor()
  await page.getByRole('button', { name: '解除 离线测试电脑 配对' }).waitFor()
  assert.deepEqual(errors, [])
  process.stdout.write(`Device UI checks passed. Screenshots: ${output}\n`)
} finally { await browser.close(); await server.close() }
