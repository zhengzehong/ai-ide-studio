/* 团队会话线「未读/置顶 + 无自动选中」冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实点击走查。
 * 运行：node tests/browser/team-unread-flow-smoke.mjs（需 chromium；失败输出 .tmp/team-unread-smoke 截图）。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/team-unread-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
// 零链接 worktree（无自身 node_modules）：按解析链找 esbuild，别写死 <root>/node_modules。
const esbuild = createRequire(import.meta.url).resolve('esbuild/bin/esbuild')
execFileSync(process.execPath, [
  esbuild,
  resolve(root, 'tests/browser/team-unread-flow-harness.tsx'),
  '--bundle', `--outfile=${resolve(outDir, 'bundle.js')}`, '--jsx=automatic', '--log-level=error',
  // harness 经 TeamChatPane 拉进 commandClient，其模块顶层读 Vite 注入的 import.meta.env（Vite 外为 undefined）。
  '--define:process.env.NODE_ENV="development"',
  '--define:import.meta.env={"MODE":"test","VITE_COMMAND_TRANSPORT":"ws"}',
])
writeFileSync(resolve(outDir, 'index.html'), '<!doctype html><html><body><link rel="stylesheet" href="bundle.css"><div id="root"></div><script src="bundle.js"></script></body></html>')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.stack || error.message))
const screenshot = async (name) => page.screenshot({ path: resolve(outDir, name) })
const state = async () => page.locator('#state').textContent()
const events = async () => page.locator('#events').textContent()
const expectState = async (matcher, message) => {
  await page.waitForFunction((matcher) => new RegExp(matcher).test(document.getElementById('state').textContent), matcher).catch(() => {})
  const text = await state()
  if (!new RegExp(matcher).test(text)) throw new Error(`${message}（实际 ${text}）`)
}

try {
  await page.goto(`file:///${resolve(outDir, 'index.html').replace(/\\/g, '/')}`)

  // ① 进团队不选线 → 空态，且列表加载完成后不得自动选中任何线
  await page.locator('#btn-enter-team').click()
  await page.getByText('从左侧选择一条会话线').waitFor()
  await page.getByText('首线').waitFor()
  await page.waitForTimeout(600) // 列表首拉 + 300ms team:update 防抖窗口都过了再看
  if ((await events()).includes('select:')) throw new Error(`进团队不应自动选线，实际事件 ${await events()}`)
  await expectState('team=t1 line=none master=none', '进团队应停在空态')
  await screenshot('01-empty.png')

  // ①b 列表刷新（team:update 重拉）也不得把线塞回来
  await page.locator('#btn-team-update').click()
  await page.waitForTimeout(700)
  if ((await events()).includes('select:')) throw new Error(`列表刷新后不得自动选线，实际事件 ${await events()}`)
  await page.getByText('从左侧选择一条会话线').waitFor()

  // ② 点线 → 选中：头部显示线标题，状态里出现 line/master
  await page.getByText('首线', { exact: true }).click()
  await expectState('line=tc-1 master=m1', '点线后应选中该线')
  await page.locator('.conversation-title').getByText('首线').waitFor()
  await screenshot('02-selected.png')

  // ③ 标未读 → 退出 → 空态；该线黄点亮起（本地失效触发列表重拉）
  await page.getByRole('button', { name: '标记未读' }).click()
  await expectState('line=none master=none', '标未读成功后应退出该线')
  await expectState('marks=tc-1', '应把该线的未读动作发给服务端')
  await page.getByText('从左侧选择一条会话线').waitFor()
  await page.locator('[title="未读"]').waitFor()
  await screenshot('03-marked-unread.png')

  // ④ 退出后再点该团队 → 仍空态，不回选
  await page.locator('#btn-enter-team').click()
  await page.waitForTimeout(400)
  const after = await events()
  if ((after.match(/select:/g) || []).length !== 1) throw new Error(`退出后再点团队不得回选，实际事件 ${after}`)
  await page.getByText('从左侧选择一条会话线').waitFor()
  await screenshot('04-reenter-stays-empty.png')

  // ⑤ 置顶次线 → 置顶线排到最前（P1-10），并写入全局会话坞
  const lineOrder = () => page.$$eval('[data-hotkey-session-list] span', nodes => nodes.map(node => node.textContent).filter(text => text === '首线' || text === '次线'))
  const before = await lineOrder()
  await page.getByText('次线', { exact: true }).click()
  await expectState('line=tc-2 master=m2', '点次线应选中次线')
  await page.getByRole('button', { name: '置顶' }).click()
  await expectState('dock=m2', '置顶应写入全局会话坞（master session）')
  await page.waitForTimeout(300)
  const order = await lineOrder()
  if (order[0] !== '次线') throw new Error(`置顶线应排最前，实际顺序 ${order.join('>')}（置顶前 ${before.join('>')}）`)
  await screenshot('05-pinned-first.png')

  if (errors.length) throw new Error(`页面报错：${errors[0]}`)

  // ⑥ 新建线仍显式选中新线（唯一保留的"替用户选线"路径）
  await page.getByTitle('新建会话').click()
  await expectState('line=tc-new-3 master=m-new-3', '新建线后应选中新线')
  await page.locator('.conversation-title').getByText('新团队会话').waitFor()
  await screenshot('06-created-selected.png')

  // ⑦ 归档当前线保持选中；⑧ 删除当前线停空态
  const row = (title) => page.locator(`[data-hotkey-session-list] [title="${title}"]`)
  await row('新团队会话').click({ button: 'right' })
  await page.getByText('归档', { exact: true }).click()
  await page.getByRole('button', { name: '归档' }).click()
  await expectState('line=tc-new-3 master=m-new-3', '归档当前线应保持选中')
  await row('新团队会话').click({ button: 'right' })
  await page.getByText('删除', { exact: true }).click()
  await page.getByRole('button', { name: '删除' }).click()
  await expectState('line=none master=none', '删除当前线应停空态')
  await page.getByText('从左侧选择一条会话线').waitFor()
  await screenshot('07-archive-delete.png')

  console.log('团队会话线冒烟通过：①空态 ②选中 ③标未读退出+黄点 ④不回选 ⑤置顶优先 ⑥新建选中 ⑦归档保持 ⑧删除空态')
} catch (error) {
  await screenshot('failure.png')
  console.error(String(error))
  if (errors.length) console.error(`页面报错：${errors.join('\n---\n')}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
