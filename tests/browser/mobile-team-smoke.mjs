import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', error => errors.push(page.url() + '\n' + (error.stack || error.message)))
const navigate = async path => page.evaluate(path => {
  history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}, path)
const screenshotDir = process.env.MOBILE_SMOKE_OUTPUT || '.tmp/mobile-team-smoke'
await mkdir(screenshotDir, { recursive: true })
try {
  await page.goto('http://127.0.0.1:5176/app/tests/team-smoke.html')
  await page.getByText('登录问题修复', { exact: true }).waitFor()
  assert.equal(await page.getByText('内部成员不可见').count(), 0)
  assert.equal(await page.getByText('发布回归检查', { exact: true }).count(), 1)
  await page.screenshot({ path: screenshotDir + '/list-390.png' })
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.getByRole('button', { name: '选择 Agent 或团队' }).click()
  await page.getByRole('button', { name: '代码审查团队团队' }).click()
  assert.equal(await page.getByRole('button', { name: '从模板', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '开始对话', exact: true }).click()
  assert.equal(await page.evaluate(() => window.teamRpcFixture.requests.find(request => request.type === 'team.conversation.create').teamId), 'team-a')
  await page.getByText('成员历史已加载', { exact: true }).waitFor()
  await page.locator('textarea').fill('请复查登录')
  await page.locator('textarea').press('Enter')
  await page.getByText('成员正在流式输出', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.teamRpcFixture.commands.at(-1).sessionId), 'master-a')
  await page.evaluate(() => window.teamRpcFixture.complete())
  await page.getByText('成员最终结果保持可见', { exact: true }).waitFor()
  await navigate('/pinned')
  await page.getByText('登录问题修复', { exact: true }).click()
  await page.getByText('成员最终结果保持可见', { exact: true }).waitFor()
  assert.equal(await page.getByText('成员最终结果保持可见', { exact: true }).count(), 1)
  await page.evaluate(() => window.teamRpcFixture.resync(true))
  await page.getByRole('alert').filter({ hasText: '模拟断线恢复失败' }).waitFor()
  assert.equal(await page.evaluate(() => window.teamRpcFixture.resyncAcks.length), 0)
  await page.evaluate(() => window.teamRpcFixture.resync(false))
  await page.waitForFunction(() => window.teamRpcFixture.resyncAcks.includes('worker'))
  assert.equal(await page.getByText('成员最终结果保持可见', { exact: true }).count(), 1)
  await navigate('/surface/master-a')
  await page.getByText('正在检查登录接口。', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Master 安排的任务 · 展开' }).click()
  await page.getByRole('button', { name: 'Master 安排的任务 · 收起' }).waitFor()
  await page.locator('#complete-fixture').click({ force: true })
  await page.getByText('检查完成，登录接口已覆盖过期场景。', { exact: true }).waitFor()
  assert.equal(await page.getByText('检查完成，登录接口已覆盖过期场景。', { exact: true }).count(), 1)
  await page.screenshot({ path: screenshotDir + '/chat-390.png' })
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: screenshotDir + '/chat-' + width + '.png' })
  }
  await navigate('/activity')
  await page.getByText('登录问题修复', { exact: true }).waitFor()
  assert.equal(await page.getByText('发布回归检查', { exact: true }).count(), 0)
  await navigate('/pinned')
  await page.getByText('登录问题修复', { exact: true }).waitFor()
  await page.getByText('代码审查团队', { exact: false }).waitFor()
  assert.deepEqual(errors, [])
  process.stdout.write('Mobile team smoke passed: mixed list, team creation, hidden members, assignment expand, completion retention, recovery failure/retry, activity, pins, 320/390/768 layouts.\n')
} catch (error) {
  await page.screenshot({ path: screenshotDir + '/failure.png' })
  process.stderr.write(JSON.stringify({ errors, text: await page.locator('body').innerText(), commands: await page.evaluate(() => window.teamRpcFixture?.commands) }) + '\n')
  throw error
} finally { await browser.close() }
