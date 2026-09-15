/* 团队 Agent dock 交互冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实点击走查。
 * 运行：node tests/browser/team-agent-dock-smoke.mjs（需 chromium；失败输出 .tmp/dock-smoke 截图）。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/dock-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [
  // 零链接 worktree（无自身 node_modules）：按解析链找 esbuild，别写死 <root>/node_modules。
  createRequire(import.meta.url).resolve('esbuild/bin/esbuild'),
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

  // 1/2. 展开为悬浮面板：绝对定位、限高 50vh、内部滚动、固定锚在输入框本体上方 8px
  await page.locator('.team-agent-dock-head').click()
  await page.getByText('点击定位该成员消息').waitFor()
  const measure = () => page.evaluate(() => {
    const dock = document.querySelector('[data-team-agent-dock]')
    const body = [...dock.children].find((child) => child.tagName === 'DIV')
    const rect = dock.getBoundingClientRect()
    const composer = document.getElementById('composer').getBoundingClientRect()
    return {
      position: getComputedStyle(dock).position,
      maxHeightPx: parseFloat(getComputedStyle(dock).maxHeight),
      innerHeight: window.innerHeight,
      overflowY: body ? getComputedStyle(body).overflowY : 'visible',
      dockTop: rect.top,
      dockBottom: rect.bottom,
      composerTop: composer.top,
      listHeight: document.querySelector('main > div:nth-of-type(2)').getBoundingClientRect().height,
    }
  })
  const dockStyles = await measure()
  if (dockStyles.position !== 'absolute') throw new Error(`dock 应为绝对定位悬浮层，实际 ${dockStyles.position}`)
  if (Math.abs(dockStyles.maxHeightPx - dockStyles.innerHeight / 2) > 1) throw new Error(`展开面板限高应为 50vh，实际 ${dockStyles.maxHeightPx}px / 视口 ${dockStyles.innerHeight}px`)
  if (dockStyles.overflowY !== 'auto') throw new Error('展开面板内部应可滚动')
  if (Math.abs(dockStyles.dockBottom - (dockStyles.composerTop - 8)) > 1) {
    throw new Error(`dock 应固定锚在输入框本体上方 8px（实际间距 ${dockStyles.composerTop - dockStyles.dockBottom}px）`)
  }
  // 2. 贴图后 dock 不动：图片条在输入框框体外增高 shell，消耗消息列表高度；dock 锚定输入框本体而非 shell 顶沿
  await page.getByRole('button', { name: '模拟贴图' }).click()
  const withImage = await measure()
  if (Math.abs(withImage.dockTop - dockStyles.dockTop) > 0.5 || Math.abs(withImage.dockBottom - dockStyles.dockBottom) > 0.5) {
    throw new Error(`贴图后 dock 位置不应移动（top ${dockStyles.dockTop}→${withImage.dockTop}，bottom ${dockStyles.dockBottom}→${withImage.dockBottom}）`)
  }
  if (withImage.composerTop !== dockStyles.composerTop) throw new Error('贴图后输入框本体位置不应变化（图片条出现在其上方）')
  const strip = await page.getByText('图片附件条（52px + 8px 间距）').boundingBox()
  if (!strip || strip.bottom > dockStyles.composerTop) throw new Error('图片条应渲染在输入框本体上方')
  if (Math.abs((dockStyles.listHeight - withImage.listHeight) - 60) > 1) {
    throw new Error(`图片条增高应由消息列表吸收（列表高度 ${dockStyles.listHeight}→${withImage.listHeight}）`)
  }
  await page.getByRole('button', { name: '模拟贴图' }).click()
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
  await page.getByText('修改「Dev-GLM」的团队模型策略与系统提示词。').waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  const masterRow = page.locator('[data-team-agent-dock] .team-agent-dock-row').filter({ hasText: '主控' })
  await masterRow.hover()
  await masterRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByText('Master 为团队主控，不可移除').waitFor()
  if (await page.getByRole('button', { name: '移除成员' }).count() !== 0) throw new Error('Master 菜单不应有移除成员')
  await page.keyboard.press('Escape')

  // 1. Master 弹窗：无策略下拉、单档案下拉预填 Agent 定义、保存走 agents.update 链且 dock 行跟随
  await masterRow.hover()
  await masterRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await page.getByText('修改「Master」的模型配置与系统提示词。').waitFor()
  if (await page.getByText('模型策略', { exact: true }).count() !== 0) throw new Error('Master 弹窗不应有模型策略下拉')
  const masterProfileSelect = page.locator('[role="dialog"] select').first()
  if (await masterProfileSelect.inputValue() !== '') throw new Error('Master 档案应预填 Agent 定义原值（此处为空=使用系统默认）')
  await masterProfileSelect.selectOption('p1')
  await page.getByText('直接修改该 Agent 的模型配置（全局生效）').waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectEvents('saveAgentModel:{"modelProfileId":"p1"}')
  await masterRow.getByText('claude-astra', { exact: true }).waitFor() // dock 行来源跟随所选档案（子行为组合文本，按名断言）
  if (await page.locator('[role="dialog"]').count() !== 0) throw new Error('Master 保存成功后应关闭弹窗')

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
  // 1. 系统提示词单框直改：预填 Agent 原值，编辑后保存走 agents.update 链
  const promptBox = page.locator('[role="dialog"] textarea')
  const prefilled = await promptBox.inputValue()
  if (prefilled !== '成员模板人设提示词') throw new Error(`系统提示词应预填 Agent 原值，实际「${prefilled}」`)
  await promptBox.fill('团队内直改的新人设')
  // 7/8. 保存 → 弹窗关闭，模型策略与提示词分别走团队配置 / Agent 更新
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectEvents('save:{"modelProfileMode":"fixed","modelProfileId":"p1"}')
  await expectEvents('savePrompt:团队内直改的新人设')
  await page.getByText('独立配置').waitFor()
  await screenshot('2-saved.png')

  // P2：部分失败 → 弹窗不关、错误显示在弹窗内、成功部分已生效；重试 dirty 跳过已成功部分
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await policySelect.selectOption('system') // 让模型策略也变脏，与提示词一起保存
  await page.locator('[role="dialog"] textarea').fill('这次会失败')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectEvents('save:{"modelProfileMode":"system","modelProfileId":null}') // 模型策略已成功并生效
  await page.getByText('提示词保存失败（模拟）').waitFor() // 错误显示在弹窗内
  if (await page.locator('[role="dialog"] textarea').count() !== 1) throw new Error('部分失败后弹窗应保持打开')
  // 重试：只补写失败的部分（模型策略已成功且未变更，不再重复写）
  const countSaveEvents = (raw) => raw.split('|').filter((item) => item.startsWith('save:')).length
  const savesBeforeRetry = countSaveEvents(await events())
  await page.locator('[role="dialog"] textarea').fill('重试成功的新人设')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expectEvents('savePrompt:重试成功的新人设')
  if (countSaveEvents(await events()) !== savesBeforeRetry) throw new Error('重试不应重复写已成功且未变更的模型策略')
  if (await page.locator('[role="dialog"]').count() !== 0) throw new Error('全部成功后应关闭弹窗')

  // 7. 系统默认策略预览走后端 fallback
  await memberRow.hover()
  await memberRow.getByRole('button', { name: '成员操作' }).click()
  await page.getByRole('button', { name: '设置 Agent' }).click()
  await policySelect.selectOption('system')
  await page.getByText('系统默认 · 未指定档案', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  // 10. 成员行中断：仅 running 的成员行渲染停止按钮，点击立即 session.cancel（无确认）
  if (await masterRow.locator('button.team-agent-dock-stop').count() !== 0) throw new Error('Master（leader）行不应渲染停止按钮')
  if (await memberRow.locator('button.team-agent-dock-stop').count() !== 0) throw new Error('空闲成员行不应渲染停止按钮')
  await page.getByRole('button', { name: '模拟成员执行中' }).click()
  const memberStop = memberRow.locator('button.team-agent-dock-stop')
  await memberStop.waitFor()
  await memberStop.click()
  // 取消进行中：按钮禁用防连点；待 80ms 取消结算后应只触发一次 session.cancel
  if (!await memberStop.isDisabled()) throw new Error('取消进行中应禁用按钮防连点')
  await expectEvents('cancel:s2')
  const countCancelEvents = (raw) => raw.split('|').filter((item) => item.startsWith('cancel:')).length
  await page.waitForTimeout(150) // 覆盖取消结算窗口，若防连点失效会在此出现第二次事件
  if (countCancelEvents(await events()) !== 1) throw new Error('防连点失败：session.cancel 被触发多次')
  await memberStop.waitFor({ state: 'visible' }) // 取消完成恢复可点（瞬态复位）
  await page.getByRole('button', { name: '模拟成员执行中' }).click() // 还原空闲，不影响后续流程

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
