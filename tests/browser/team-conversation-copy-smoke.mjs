/* 团队会话线「复制」冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实点击走查。
 * 运行：node tests/browser/team-conversation-copy-smoke.mjs（需 chromium；失败输出 .tmp/team-conversation-copy-smoke 截图）。
 * 覆盖：右键空闲线 → 复制菜单 → 确认弹窗语义披露 → copy RPC → 新线出现并自动选中 /
 *       running 线复制菜单置灰 / copy 失败错误条透出原因。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/team-conversation-copy-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const esbuild = createRequire(import.meta.url).resolve('esbuild/bin/esbuild')
execFileSync(process.execPath, [
  esbuild,
  resolve(root, 'tests/browser/team-conversation-copy-harness.tsx'),
  '--bundle', `--outfile=${resolve(outDir, 'bundle.js')}`, '--jsx=automatic', '--log-level=error',
  '--define:process.env.NODE_ENV="development"',
  '--define:import.meta.env={"MODE":"test","VITE_COMMAND_TRANSPORT":"ws"}',
])
writeFileSync(resolve(outDir, 'index.html'), '<!doctype html><html><body><link rel="stylesheet" href="bundle.css"><div id="root"></div><script src="bundle.js"></script></body></html>')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.stack || error.message))
const screenshot = async (name) => page.screenshot({ path: resolve(outDir, name) })
const rpc = async () => page.locator('#rpc').textContent()
const events = async () => page.locator('#events').textContent()
const check = (condition, message) => { if (!condition) throw new Error(message) }
const row = (sessionId) => page.locator(`[data-session-row="${sessionId}"]`)

try {
  await page.goto(`file:///${resolve(outDir, 'index.html').replace(/\\/g, '/')}`)
  await row('m1').waitFor({ timeout: 15_000 })
  check(await row('m2').count() === 1, '列表应同时渲染空闲线与 running 线')
  await screenshot('01-list.png')

  // ① 右键空闲线 → 复制菜单可用 → 确认弹窗带语义披露
  // 注意用精确匹配：头部「模拟复制失败」按钮含「复制」子串，会污染 hasText 定位。
  await row('m1').click({ button: 'right' })
  const copyMenuItem = page.getByRole('button', { name: '复制', exact: true })
  await copyMenuItem.waitFor({ timeout: 5_000 })
  check(!(await copyMenuItem.isDisabled()), '空闲线的复制菜单应可用')
  await copyMenuItem.click()
  const dialog = page.locator('text=将复制“首线”')
  await dialog.waitFor({ timeout: 5_000 })
  check((await dialog.textContent()).includes('新线转录为空'), '确认弹窗应披露「新线转录为空」语义')
  check((await dialog.textContent()).includes('排队中未执行的消息将留在原线执行'), '确认弹窗应披露排队消息留在原线')
  await screenshot('02-confirm-dialog.png')
  await page.getByRole('button', { name: '复制', exact: true }).click()

  // ② copy RPC 发出 → 新线占位出现在列表顶部 → 自动选中新线
  await page.waitForTimeout(300)
  check((await rpc()).includes('copy:tc-1'), `应发出 team.conversation.copy RPC，实际 rpc=${await rpc()}`)
  await row('m-new').waitFor({ timeout: 5_000 })
  check((await events()).includes('master:m-new'), `复制成功应回填 Master 会话，实际 events=${await events()}`)
  check((await events()).includes('select:tc-new'), `复制成功应自动选中新线，实际 events=${await events()}`)
  await screenshot('03-copied.png')

  // ③ running 线复制菜单置灰（在跑的线不允许复制）
  await row('m2').click({ button: 'right' })
  const runningCopyItem = page.getByRole('button', { name: '复制', exact: true })
  await runningCopyItem.waitFor({ timeout: 5_000 })
  check(await runningCopyItem.isDisabled(), 'running 线的复制菜单应置灰')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)

  // ④ copy 失败：错误条透出服务端原因（忙线拒绝文案）
  await page.locator('#btn-fail').click()
  await row('m1').click({ button: 'right' })
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await page.getByRole('button', { name: '复制', exact: true }).click()
  await page.locator('[role="alert"]', { hasText: '团队会话正在运行或有排队消息' }).waitFor({ timeout: 5_000 })
  await screenshot('04-copy-failed.png')

  if (errors.length > 0) throw new Error(`页面错误：${errors.join('\n')}`)
  console.log('OK team-conversation-copy-smoke 全部通过')
} catch (error) {
  await screenshot('99-failure.png').catch(() => undefined)
  console.error(String(error))
  process.exitCode = 1
} finally {
  await browser.close()
}
