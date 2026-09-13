import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

let browser: Browser
let bundle: string
const browserAvailable = existsSync(chromium.executablePath())
beforeAll(async () => {
  if (!browserAvailable) return
  const result = await build({
    entryPoints: [resolve('tests/fixtures/workspace-selection-browser.tsx')], bundle: true, write: false,
    format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{"MODE":"test"}' },
    plugins: [{ name: 'isolated-transport', setup(builder): void {
      builder.onResolve({ filter: /\/ws-client$/ }, () => ({ path: resolve('tests/fixtures/workspace-selection-ws.ts') }))
    } }],
  })
  bundle = result.outputFiles[0].text
  browser = await chromium.launch({ headless: true })
}, 30_000)
afterAll(async () => { await browser?.close() })

async function fixture(): Promise<Page> {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://workspace.test')
  await page.addScriptTag({ content: bundle })
  try {
    await page.waitForFunction(() => document.querySelector('#state')?.textContent?.includes('session-a'), undefined, { timeout: 3000 })
  } catch (error) {
    const content = await page.locator('body').innerText()
    await page.close()
    throw new Error(`Fixture failed: ${errors.join('; ')}; ${content}`, { cause: error })
  }
  return page
}
async function state(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await page.locator('#state').innerText()) as Record<string, unknown>
}
async function readCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { readRequests: () => unknown[] }).readRequests().length)
}

describe.skipIf(!browserAvailable)('Workspace restore and visibility lifecycle in React', () => {
  test('restores the matching Agent, keeps a team selected through updates, and reads only on return', async () => {
    const page = await fixture()
    try {
      expect(await state(page)).toMatchObject({ currentSessionId: 'session-a', selectedAgentId: 'agent-a' })
      await page.click('#team')
      const reads = await readCount(page)
      await page.click('#refresh')
      await page.click('#done')
      expect(await state(page)).toMatchObject({ currentSessionId: null, selectedTeamId: 'team', unread: true })
      expect(await readCount(page)).toBe(reads)
      await page.click('#ordinary')
      expect(await state(page)).toMatchObject({ currentSessionId: 'session-a', selectedAgentId: 'agent-a', selectedTeamId: null, unread: false })
      expect(await readCount(page)).toBe(reads + 1)
    } finally { await page.close() }
  })

  test('does not resurrect the last Session for an Agent without a primary Session', async () => {
    const page = await fixture()
    try {
      await page.click('#empty-agent')
      await page.click('#refresh')
      expect(await state(page)).toMatchObject({ currentSessionId: null, selectedAgentId: 'empty' })
      await page.click('#project')
      await page.waitForFunction(() => document.querySelector('#state')?.textContent?.includes('session-b'))
      expect(await state(page)).toMatchObject({ currentSessionId: 'session-b', selectedAgentId: 'agent-b' })
    } finally { await page.close() }
  })

  test('keeps a file-hidden conversation unread until chat is shown again', async () => {
    const page = await fixture()
    try {
      await page.click('#file')
      const reads = await readCount(page)
      await page.click('#done')
      expect(await state(page)).toMatchObject({ currentSessionId: 'session-a', unread: true })
      expect(await readCount(page)).toBe(reads)
      await page.click('#file')
      expect(await state(page)).toMatchObject({ currentSessionId: 'session-a', unread: false })
      expect(await readCount(page)).toBe(reads + 1)
    } finally { await page.close() }
  })

  test('keeps explicit unread after deselection and does not immediately restore it', async () => {
    const page = await fixture()
    try {
      const reads = await readCount(page)
      await page.click('#unread')
      await page.click('#refresh')
      expect(await state(page)).toMatchObject({ currentSessionId: null, unread: true })
      expect(await readCount(page)).toBe(reads)
    } finally { await page.close() }
  })

  test('releases read visibility when the Workspace unmounts', async () => {
    const page = await fixture()
    try {
      const reads = await readCount(page)
      await page.evaluate(() => {
        const fixtureWindow = window as unknown as { unmountFixture: () => void; completeHidden: () => void }
        fixtureWindow.unmountFixture()
        fixtureWindow.completeHidden()
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(await readCount(page)).toBe(reads)
      expect(await page.evaluate(() => (window as unknown as { isUnread: () => boolean }).isUnread())).toBe(true)
    } finally { await page.close() }
  })
})
