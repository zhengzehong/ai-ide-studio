/* 滚动跟随修复冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实浏览器断言。
 * 覆盖：运行中切走→切回后停底并持续跟随；手动上滚立即解除；回到近底恢复跟随；
 * 空闲切回精确落底；非虚拟路径（10 条）同样跟随；两段式装载（replay 合并不改条目数）回底；
 * 程序性回落（无用户输入）不被判死；追逐窗口内点击不解除跟随；滚动条拖拽上行仍解除。
 * 运行：node tests/browser/chat-scroll-follow-smoke.mjs（需 chromium；失败输出 .tmp/scroll-smoke 截图）。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
// 零链接 worktree 兼容：node_modules 由 Node 向上解析到主仓（不建 junction，只读使用）。
const esbuildBin = createRequire(import.meta.url).resolve('esbuild/bin/esbuild')
const outDir = resolve(root, '.tmp/scroll-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [
  esbuildBin,
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

  // ── 场景 3：手动滚回近底部后恢复跟随（循环小步滚动：单次大 delta 会被浏览器截断）──
  for (let step = 0; step < 40; step += 1) {
    const value = await metrics()
    if (value.distance <= 1) break
    await page.mouse.wheel(0, 2000)
    await page.waitForTimeout(25)
  }
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

  // ── 场景 6：两段式装载（base 交付 → 宽限过期 → replay 合并、条目数不变）必须贴底 ──
  await page.click('#btn-two-stage')
  await requireSettle('两段式 base 交付后应贴底')
  await page.waitForTimeout(700) // 关键：第二波落在 500ms 宽限之外（原缺陷窗口）
  await page.click('#btn-replay')
  await requireSettle('两段式 replay 合并后应贴底（条目数不变也要回底）')
  await page.waitForTimeout(800)
  await requireSettle('两段式 replay 合并后应持续贴底')
  await screenshot('5-two-stage-follow.png')

  // ── 场景 7：程序性回落（无 wheel/pointer，布局重排/clamp 等价物）不被判死，内容再落地即回底 ──
  await page.evaluate('window.__smoke.dropPx(400)')
  await page.waitForTimeout(250)
  const dropped = await metrics()
  if (dropped.distance < 300) throw new Error(`程序性回落未生效（距底 ${dropped.distance}px）`)
  await page.click('#btn-grow')
  await requireSettle('程序性回落 + 内容再落地后应回到底部（P0-b + P1）')
  await screenshot('6-programmatic-drop.png')

  // ── 场景 8：追逐窗口内点击（base 交付后立即在消息区真实点一下）不解除跟随 ──
  // 等价 A 路装置 R9：点击 → 视口被推（布局重排/锚定补偿的 scroll 事件）→ 大内容落地。
  await page.click('#btn-two-stage-off')
  await page.click('#btn-two-stage')
  await page.waitForTimeout(120) // 仍在宽限/装载追逐窗口内
  const chaseBox = await page.locator('.conversation-message-scroll').boundingBox()
  await page.mouse.click(chaseBox.x + chaseBox.width / 2, chaseBox.y + chaseBox.height / 2)
  await page.click('#btn-grow')
  await requireSettle('追逐窗口内点击后内容继续落地应贴底（点击不是滚动意图）')
  await page.evaluate('window.__smoke.dropPx(300)') // 点击之后视口被页面自己推走（无 wheel/无拖拽）
  await page.waitForTimeout(150)
  await page.click('#btn-grow')
  await requireSettle('点击 + 程序性回落 + 内容再落地后应贴底（R9 等价）')
  await page.waitForTimeout(600)
  await requireSettle('点击 + 程序性回落后应持续贴底')
  await screenshot('7-chase-window-click.png')

  // ── 场景 9：滚动条拖拽上行仍必须解除跟随（槽位按下＝拖拽意图，无 wheel 也要解除）──
  await page.click('#btn-two-stage-off')
  await page.click('#btn-two-stage')
  await requireSettle('滚动条拖拽前置：应贴底')
  await page.waitForTimeout(700)
  const gutterBox = await page.locator('.conversation-message-scroll').boundingBox()
  await page.mouse.move(gutterBox.x + gutterBox.width - 1, gutterBox.y + gutterBox.height / 2) // 内容盒最右一像素（滚动条槽位；无头浏览器隐藏滚动条，无法真实拖动滑块）
  await page.mouse.down()
  await page.evaluate('window.__smoke.dropPx(400)') // 拖拽上行的等价位移（无 wheel）
  await page.mouse.up()
  await page.waitForTimeout(250)
  const afterDrag = await metrics()
  if (afterDrag.distance <= 100) throw new Error(`滚动条拖拽上行应解除跟随（距底 ${afterDrag.distance}px）`)
  await page.click('#btn-grow') // 内容再落地：不得把正在阅读的用户拉回
  await page.waitForTimeout(600)
  const afterDragGrow = await metrics()
  if (afterDragGrow.distance <= 100) throw new Error(`滚动条拖拽解除后不应被内容再落地拉回（距底 ${afterDragGrow.distance}px）`)
  await screenshot('8-scrollbar-drag.png')

  // ── 场景 9b：内容区按下并位移超阈值（触摸拖动等价物）后上行同样解除 ──
  await page.click('#btn-two-stage-off')
  await page.click('#btn-two-stage')
  await requireSettle('内容拖拽前置：应贴底')
  await page.waitForTimeout(700)
  const dragBox = await page.locator('.conversation-message-scroll').boundingBox()
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2 - 40, { steps: 8 })
  await page.evaluate('window.__smoke.dropPx(400)')
  await page.mouse.up()
  await page.waitForTimeout(250)
  const afterContentDrag = await metrics()
  if (afterContentDrag.distance <= 100) throw new Error(`内容拖拽上行应解除跟随（距底 ${afterContentDrag.distance}px）`)
  await page.click('#btn-grow')
  await page.waitForTimeout(600)
  const afterContentDragGrow = await metrics()
  if (afterContentDragGrow.distance <= 100) throw new Error(`内容拖拽解除后不应被内容再落地拉回（距底 ${afterContentDragGrow.distance}px）`)

  if (errors.length > 0) throw new Error(`页面错误: ${errors.join('\n')}`)
  console.log('chat-scroll-follow-smoke: all checks passed')
} catch (error) {
  await screenshot('failure.png').catch(() => {})
  console.error(`chat-scroll-follow-smoke failed: ${error.message}\n页面错误: ${errors.join('\n')}`)
  process.exitCode = 1
} finally {
  await browser.close()
}