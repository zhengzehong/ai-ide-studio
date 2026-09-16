/* 团队线「定向发送目标胶囊 + 就地档位/权限」冒烟：esbuild 打包 harness → file:// 页面 → Playwright 真实点击走查。
 * 运行：node tests/browser/team-directed-target-smoke.mjs（需 chromium；失败输出 .tmp/team-directed-smoke 截图）。
 * 覆盖：胶囊默认全体 / 选成员变蓝 / 就地档位（含 Max，写 session.setConfig）/ 权限（展示+跳转，不就地写）/
 *       定向发送走 team.member.message + 忙时排队态 + 转录块徽标 / 旧 codex 成员档位禁用 / 清除目标回全体。
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const outDir = resolve(root, '.tmp/team-directed-smoke')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const esbuild = createRequire(import.meta.url).resolve('esbuild/bin/esbuild')
execFileSync(process.execPath, [
  esbuild,
  resolve(root, 'tests/browser/team-directed-target-harness.tsx'),
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
const composerButton = (label) => page.locator('.conversation-toolbar-button', { hasText: label }).first()
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  await page.goto(`file:///${resolve(outDir, 'index.html').replace(/\\/g, '/')}`)
  await page.locator('.conversation-composer textarea').waitFor({ timeout: 15_000 })

  // ① 默认全体：胶囊显示「全体」，非 is-directed；就地控制开关不出现（沿用普通会话的档位/权限按钮）
  const capsule = page.locator('.conversation-toolbar-button').first()
  check((await capsule.textContent()).includes('全体'), `默认胶囊应为「全体」，实际 ${await capsule.textContent()}`)
  check(!(await capsule.getAttribute('class')).includes('is-directed'), '未选中成员时胶囊不应是 is-directed')
  // 服务端已落库的定向消息 → 转录块「你 → Dev-GLM」+ 已完成徽标 + 绕过 Master 脚注
  await page.locator('.conversation-team-assignment-header', { hasText: '你 → Dev-GLM' }).waitFor({ timeout: 10_000 })
  await page.locator('.directed-badge', { hasText: '已完成' }).waitFor()
  await screenshot('01-default-all.png')

  // ② @ 唤起成员菜单 → 选 Dev-GLM：胶囊变蓝 + ✕ 清除位
  await page.locator('.conversation-composer textarea').click()
  await page.locator('.conversation-composer textarea').type('@')
  await page.locator('.conversation-menu button', { hasText: 'Dev-GLM' }).click()
  await page.waitForTimeout(150)
  const directedCapsule = page.locator('.conversation-toolbar-button.is-directed').first()
  check((await directedCapsule.textContent()).includes('Dev-GLM'), `选中后胶囊应显示 Dev-GLM，实际 ${await directedCapsule.textContent()}`)
  await page.locator('.composer-target-clear').waitFor()
  await screenshot('02-target-selected.png')

  // ③ 档位开关就地变为该成员控制：显示成员当前档位「中」；菜单头「对 Dev-GLM · 下一回合生效」+ 含 Max；选择 Max 写 session.setConfig
  const effortButton = composerButton('中')
  check(await effortButton.count() > 0, '选中成员后档位开关应显示该成员当前档位（中）')
  await effortButton.click()
  await page.locator('.conversation-menu-scope', { hasText: '对 Dev-GLM · 下一回合生效' }).waitFor({ timeout: 5_000 })
  await page.locator('.conversation-menu button', { hasText: 'Max' }).waitFor()
  await screenshot('03-effort-menu.png')
  await page.locator('.conversation-menu button', { hasText: 'Max' }).click()
  await page.waitForTimeout(150)
  check((await rpc()).includes('setConfig:s2:effort=max'), `档位选择应写成员会话 s2 的 effort，实际 rpc=${await rpc()}`)
  check(await composerButton('Max').count() > 0, '写成功后档位开关应就地回填为所选档位（Max）')

  // ④ 权限开关就地变为该成员控制：展示 + 跳转，不就地写
  const permButton = composerButton('跳过权限')
  check(await permButton.count() > 0, '选中成员后权限开关应显示该成员模式（跳过权限）')
  await permButton.click()
  await page.locator('.conversation-menu', { hasText: 'claude 维度：权限模式' }).waitFor({ timeout: 5_000 })
  await page.locator('.conversation-menu button', { hasText: '打开工具权限设置' }).click()
  await page.waitForTimeout(150)
  check((await page.locator('#events').textContent()).includes('open-tools:a-glm'), `权限跳转应预选成员 Agent，实际 events=${await page.locator('#events').textContent()}`)
  check(!(await rpc()).includes('setConfig:s2:mode'), 'P0 权限只展示+跳转，不得就地写模式')

  // ⑤ 定向发送：消息走 team.member.message（不进 Master 会话）；成员空闲 → 已定向提示；输入框清空
  await page.locator('.conversation-composer textarea').fill('看看这个空指针')
  await page.locator('.conversation-send').click()
  await page.waitForTimeout(200)
  check((await rpc()).includes('directed:tm-2:看看这个空指针'), `发送应走 team.member.message 且目标为 tm-2，实际 rpc=${await rpc()}`)
  await page.locator('.conversation-composer-queued', { hasText: '已定向发给 Dev-GLM' }).waitFor({ timeout: 5_000 })
  await page.locator('.conversation-team-assignment-header', { hasText: '你 → Dev-GLM' }).nth(1).waitFor()
  await screenshot('04-directed-sent.png')

  // ⑥ 忙时排队态：成员执行中 → 发送回执 queued → 本地待落账块显示「排队中 · 等待空闲」
  await page.locator('#btn-busy').click()
  await page.locator('.conversation-composer textarea').fill('排队消息')
  await page.locator('.conversation-send').click()
  await page.waitForTimeout(200)
  await page.locator('.conversation-composer-queued', { hasText: '已排队：Dev-GLM 正在执行' }).waitFor({ timeout: 5_000 })
  await page.locator('.directed-badge', { hasText: '排队中' }).waitFor()
  await screenshot('05-queued.png')

  // ⑦ 服务端落库后本地待落账块被真实块替换（不重复显示）
  await page.locator('#btn-land').click()
  await page.waitForTimeout(600)
  const pendingBlocks = await page.locator('.conversation-team-assignment-header', { hasText: '刚发的定向消息' }).count()
  check(pendingBlocks <= 1, `落库后不得出现重复转录块，实际 ${pendingBlocks}`)
  await page.locator('#btn-busy').click()
  await screenshot('06-landed.png')

  // ⑧ 旧 codex 适配器成员（无档位 configOption）：档位开关禁用「档位不可用」，权限开关禁用
  await page.locator('.conversation-composer textarea').click()
  await page.locator('.conversation-composer textarea').type('@')
  await page.locator('.conversation-menu button', { hasText: 'Dev-Kimi-Legacy' }).click()
  await page.waitForTimeout(150)
  const disabledEffort = composerButton('档位不可用')
  check(await disabledEffort.count() > 0, '旧 codex 成员应显示禁用的「档位不可用」开关')
  check(await disabledEffort.isDisabled(), '旧 codex 成员的档位开关必须禁用（严禁对不存在的 configId 发写入）')
  const disabledPerm = composerButton('权限项不可用')
  check(await disabledPerm.count() > 0 && await disabledPerm.isDisabled(), '旧 codex 成员的权限开关应禁用')
  await screenshot('07-legacy-codex.png')

  // ⑨ 清除目标 → 回全体（消息重走 Master）
  await page.locator('.composer-target-clear').click()
  await page.waitForTimeout(150)
  check((await capsule.textContent()).includes('全体'), '清除目标后胶囊应回到「全体」')
  await screenshot('08-cleared.png')

  if (errors.length > 0) throw new Error(`页面错误：${errors.join('\n')}`)
  console.log('OK team-directed-target-smoke 全部通过')
} catch (error) {
  await screenshot('99-failure.png').catch(() => undefined)
  console.error(String(error))
  process.exitCode = 1
} finally {
  await browser.close()
}
