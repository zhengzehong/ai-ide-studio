/* 滚动跟随修复冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实浏览器断言。
 * 覆盖：运行中切走→切回后停底并持续跟随；手动上滚立即解除；回到近底恢复跟随；
 * 空闲切回精确落底；非虚拟路径（10 条）同样跟随。
 * 运行：node tests/browser/chat-scroll-follow-smoke.mjs（需 chromium；失败输出 .tmp/scroll-smoke 截图）。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/scroll-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [
  resolve(root, 'node_modules/esbuild/bin/esbuild'),
  resolve(root, 'tests/browser/chat-scroll-follow-harness.tsx'),
  '--bundle', `--outfile=${resolve(outDir, 'bundle.js')}`, '--jsx=automatic', '--log-level=error',
])
writeFileSync(resolve(outDir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="bundle.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.stack || error.message))
const screenshot = async (name) => page.screenshot({ path: resolve(outDir, name) })
const metrics = () => page.evaluate(() => {
  const el = document.querySelector('.conversation-message-scroll')
  if (!el) throw new Error('未找到滚动容器 .conversation-message-scroll')
  return { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, clientHeight: el.clientHeight, distance: el.scrollHeight - el.scrollTop - el.clientHeight }
})
// 轮询到贴底（距底 ≤1px）；跟随正常时几十毫秒内即返回，被锁死/不跟随时超时返回当前值。
const waitForSettle = async (timeoutMs = 2500) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await metrics()
    if (value.distance <= 1) return value
    if (Date.now() > deadline) return value
    await page.waitForTimeout(40)
  }
}
const requireSettle = async (label, timeoutMs = 2500) => {
  const value = await waitForSettle(timeoutMs)
  if (value.distance > 1) throw new Error(`${label}：应停于底部，实际距底 ${value.distance}px（scrollHeight ${value.scrollHeight} / scrollTop ${value.scrollTop} / clientHeight ${value.clientHeight}）`)
  return value
}

try {
  await page.goto(`file:///${resolve(outDir, 'index.html').replace(/\\/g, '/')}`)
  await page.locator('.conversation-message-scroll').waitFor()

  // ── 场景 1：运行中切走 → 切回（虚拟路径，45 条消息 + 高流式气泡）──
  await page.click('#btn-stream')
  await page.waitForTimeout(500)
  const initial = await waitForSettle(2000)
  if (initial.distance > 1) throw new Error(`初始流式应贴底，实际距底 ${initial.distance}px`)

  await page.click('#btn-away')
  await page.waitForTimeout(700) // 切走期间内容持续增长（缓存冻结）
  await page.click('#btn-back')
  await requireSettle('运行中切回后应停于底部')
  await page.waitForTimeout(1000) // 宽限/兜底窗口走完，流式继续
  await requireSettle('运行中切回后应持续跟随（1s 后仍贴底）')
  await screenshot('1-running-follow.png')

  // ── 场景 1b：非签名来源撑高 + 随之到达的 scroll 事件不破坏跟随（增长豁免的端到端断言）──
  await page.click('#btn-stream') // 暂停流式：确保没有在途的跟随滚动
  await page.waitForTimeout(400)
  await requireSettle('暂停流式后应停在底部')
  const beforeStatic = await metrics()
  await page.click('#btn-late-scroll') // 底部窗口内历史消息撑高 + 同步派发 scroll 事件
  const afterStatic = await metrics()
  if (afterStatic.scrollHeight - beforeStatic.scrollHeight < 200) {
    throw new Error(`非签名撑高未生效（scrollHeight ${beforeStatic.scrollHeight} → ${afterStatic.scrollHeight}）`)
  }
  await page.click('#btn-stream') // 恢复流式：跟随必须仍然有效
  await page.waitForTimeout(400)
  await requireSettle('非签名撑高后应仍在底部（增长豁免）')
  await page.waitForTimeout(600)
  await requireSettle('非签名撑高后应持续跟随')

  // ── 场景 2：手动上滚立即解除跟随（且不被内容增长拉回）──
  const box = await page.locator('.conversation-message-scroll').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(250)
  const released = await metrics()
  if (released.distance <= 100) throw new Error(`手动上滚应解除跟随（距底 ${released.distance}px）`)
  await page.waitForTimeout(600) // 期间流式仍在增长
  const stillReleased = await metrics()
  if (stillReleased.distance <= 100) throw new Error(`解除后不应被内容增长拉回（距底 ${stillReleased.distance}px）`)
  await screenshot('2-manual-release.png')

  // ── 场景 3：手动滚回近底部后恢复跟随 ──
  await page.mouse.wheel(0, 20000)
  await requireSettle('滚回底部后应恢复跟随', 3000)

  // ── 场景 4：空闲（停止流式）切回精确落底 ──
  await page.click('#btn-stream')
  await page.waitForTimeout(200)
  await page.click('#btn-away')
  await page.waitForTimeout(500)
  await page.click('#btn-back')
  await page.waitForTimeout(1200)
  const idle = await metrics()
  if (idle.distance > 1) throw new Error(`空闲切回应精确落底，实际距底 ${idle.distance}px`)
  await screenshot('3-idle-back.png')

  // ── 场景 5：非虚拟路径（10 条消息）运行中切回同样跟随 ──
  await page.click('#btn-count-10')
  await page.click('#btn-stream')
  await page.waitForTimeout(500)
  await page.click('#btn-away')
  await page.waitForTimeout(700)
  await page.click('#btn-back')
  await requireSettle('非虚拟路径运行中切回应停于底部')
  await page.waitForTimeout(800)
  await requireSettle('非虚拟路径运行中切回应持续跟随')
  await page.click('#btn-stream')
  await screenshot('4-plain-mode-follow.png')

  if (errors.length > 0) throw new Error(`页面错误: ${errors.join('\n')}`)
  console.log('chat-scroll-follow-smoke: all checks passed')
} catch (error) {
  await screenshot('failure.png').catch(() => {})
  console.error(`chat-scroll-follow-smoke failed: ${error.message}\n页面错误: ${errors.join('\n')}`)
  process.exitCode = 1
} finally {
  await browser.close()
}