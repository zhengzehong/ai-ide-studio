/* 团队 Agent dock 交互冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实点击走查。
 * 运行：node tests/browser/team-agent-dock-smoke.mjs（需 chromium；失败输出 .tmp/dock-smoke 截图）。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/dock-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [
  resolve(root, 'node_modules/esbuild/bin/esbuild'),
  resolve(root, 'tests/browser/team-agent-dock-harness.tsx'),
  '--bundle', `--outfile=${resolve(outDir, 'bundle.js')}`, '--jsx=automatic', '--log-level=error',
])
writeFileSync(resolve(outDir, 'index.html'), '<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.stack || error.message))
const screenshot = async (name) => page.screenshot({ path: resolve(outDir, name) })
const events = () => page.evaluate(() => document.getElementById('events').textContent)
const expectEvents = (expected) => page.waitForFunction(
  (expected) => document.getElementById('events').textContent.split('|').includes(expected),
  expected,
)

try {
  await page.goto(`file:///${resolve(outDir, 'index.html').replace(/\\/g, '/')}`)

  // 1. 悬浮层 + 默认收起：只有"团队 Agent · N 人"细条，无成员行
  await page.getByText('团队 Agent · 2 人', { exact: true }).waitFor()
  if (await page.getByText('点击定位该成员消息').count() !== 0) throw new Error('dock 默认应为收起态')

  // 1/2. 展开为悬浮面板：绝对定位、限高 50vh、内部滚动、锚在 Composer 之上
  await page.locator('.team-agent-dock-head').click()
  await page.getByText('点击定位该成员消息').waitFor()
  const dockStyles = await page.evaluate(() => {
    const dock = document.querySelector('[data-team-agent-dock]')
    const body = [...dock.children].find((child) => child.tagName === 'DIV')
    const rect = dock.getBoundingClientRect()
    const composer = document.getElementById('composer').getBoundingClientRect()
    return {
      position: getComputedStyle(dock).position,
      maxHeightPx: parseFloat(getComputedStyle(dock).maxHeight),
      innerHeight: window.innerHeight,
      overflowY: body ? getComputedStyle(body).overflowY : 'visible',
      dockBottom: rect.bottom,
      composerTop: composer.top,
      listHeight: document.querySelector('main > div:nth-of-type(2)').getBoundingClientRect().height,
    }
  })
  if (dockStyles.position !== 'absolute') throw new Error(`dock 应为绝对定位悬浮层，实际 ${dockStyles.position}`)
  if (Math.abs(dockStyles.maxHeightPx - dockStyles.innerHeight / 2) > 1) throw new Error(`展开面板限高应为 50vh，实际 ${dockStyles.maxHeightPx}px / 视口 ${dockStyles.innerHeight}px`)
  if (dockStyles.overflowY !== 'auto') throw new Error('展开面板内部应可滚动')
  if (dockStyles.dockBottom > dockStyles.composerTop) throw new Error(`悬浮面板不应遮挡 Composer（bottom ${dockStyles.dockBottom} > composerTop ${dockStyles.composerTop}）`)
  if (Math.abs(dockStyles.listHeight - 320) > 1) throw new Error(`消息列表占位高度被 dock 挤压：${dockStyles.listHeight}`)
  await page.getByText('执行中', { exact: true }).waitFor()
  await page.getByText('空闲', { exact: true }).waitFor()
  await page.getByText('Master 档案').waitFor()
  await page.getByText('继承 Master').waitFor()
  await screenshot('1-expanded.png')

  // 1. 收起状态记忆：刷新后保持展开
  await page.reload()
  await page.getByText('点击定位该成员消息').waitFor()
  // 收起 → 刷新 → 仍收起
  await page.locator('.team-agent-dock-head').click()
  await page.reload()
  if (await page.getByText('点击定位该成员消息').count() !== 0) throw new Error('收起状态未写入 localStorage 记忆')
  await page.locator('.team-agent-dock-head').click()
  await page.getByText('点击定位该成员消息').waitFor()

  // 5. 点击行定位（回调）
  await page.getByText('Dev-GLM', { exact: true }).click()
  await expectEvents('locate:tm-1')

  // 6. 悬停 ⋯ 菜单：成员含移除；Master 只有设置 + 不可移除说明
  const memberRow = page.locator('[data-team-agent-dock] .team-agent-dock-row').filter({ hasText: 'Dev-GLM' })
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await page.getByText('修改「Dev-GLM」在团队内的模型和系统提示词。').waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  const masterRow = page.locator('[data-team-agent-dock] .team-agent-dock-row').filter({ hasText: '主控' })
  await masterRow.hover()
  await masterRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByText('Master 为团队主控，不可移除').waitFor()
  if (await page.getByRole('button', { name: '移除成员' }).count() !== 0) throw new Error('Master 菜单不应有移除成员')
  await page.keyboard.press('Escape')

  // 6. 右键成员行弹菜单
  await memberRow.click({ button: 'right' })
  await page.getByRole('button', { name: '设置 Agent' }).waitFor()
  await page.keyboard.press('Escape')

  // 7. 设置弹窗：inherit 时档案下拉禁用；切到固定后启用且按 runtime 过滤
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  const policySelect = page.getByRole('combobox').first()
  await policySelect.selectOption('fixed')
  const profileSelect = page.getByRole('combobox').nth(1)
  await profileSelect.selectOption('p1')
  await page.getByText('claude-astra · 独立配置').first().waitFor()
  // 7/8. 保存 → 弹窗关闭，dock 行来源立即更新
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectEvents('save:{"modelProfileMode":"fixed","modelProfileId":"p1","systemPromptOverride":null}')
  await page.getByText('独立配置').waitFor()
  await screenshot('2-saved.png')

  // 7. 系统默认策略预览走后端 fallback
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await policySelect.selectOption('system')
  await page.getByText('系统默认 · 未指定档案', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  // 9. 移除：设置弹窗 → 移除成员 → 二次确认 → 行/计数同步
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await page.getByRole('button', { name: '移除成员' }).click()
  await page.getByText('移除「Dev-GLM」').waitFor()
  await page.getByText('历史消息会保留').waitFor()
  await screenshot('3-confirm.png')
  await page.getByRole('button', { name: '移除', exact: true }).click()
  await expectEvents('removed')
  await page.getByText('团队 Agent · 1 人', { exact: true }).waitFor()
  await screenshot('4-after-remove.png')

  if (errors.length > 0) throw new Error(`页面错误: ${errors.join('\n')}`)
  console.log('team-agent-dock-smoke: all interaction checks passed')
} catch (error) {
  await screenshot('failure.png').catch(() => {})
  console.error(`team-agent-dock-smoke failed: ${error.message}\n页面错误: ${errors.join('\n')}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
