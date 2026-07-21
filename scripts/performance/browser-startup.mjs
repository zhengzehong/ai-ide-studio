import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const HARD_REFRESH_BUDGET_MS = 300
const CACHED_SWITCH_BUDGET_MS = 50
const ITERATIONS = 7
const CHROME_PATH = process.env.PLAYWRIGHT_CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

async function main() {
  process.env.NODE_ENV = 'production'
  process.env.LOG_LEVEL = 'fatal'
  const tmp = mkdtempSync(resolve(tmpdir(), 'ai-ide-browser-performance-'))
  let app
  let browser
  try {
    const { initDatabase, closeDatabase } = await import('../../dist/store/db.js')
    const { projectStore } = await import('../../dist/store/projects.js')
    const dbPath = resolve(tmp, 'ai-ide.sqlite')
    initDatabase(dbPath)
    const first = projectStore.create({ name: 'Browser Project A', workDir: tmp })
    const second = projectStore.create({ name: 'Browser Project B', workDir: tmp })
    closeDatabase()
    const { startApp } = await import('../../dist/app.js')
    app = await startApp({
      host: '127.0.0.1',
      port: 0,
      dataDir: tmp,
      runtime: 'web',
      dataWorkerMode: 'worker',
      realtimeMode: 'embedded',
      runtimeMode: 'embedded',
      staticDir: resolve('ui/dist'),
      mobileStaticDir: resolve('mobile/dist'),
    })
    const baseUrl = httpBase(app)
    browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${baseUrl}/projects`, { waitUntil: 'domcontentloaded' })
    await seedSnapshot(page, [first, second], first.id)

    const hardRefreshMs = []
    for (let index = 0; index < ITERATIONS; index += 1) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => performance.getEntriesByName('ai-ide-interactive').length > 0)
      hardRefreshMs.push(await page.evaluate(() => performance.getEntriesByName('ai-ide-interactive')[0].startTime))
    }

    const paths = ['/projects', '/settings', `/p/${first.id}/workspace`, `/p/${second.id}/workspace`]
    for (const path of paths) await navigate(page, path)
    const cachedSwitchMs = []
    for (let index = 0; index < ITERATIONS * 2; index += 1) {
      cachedSwitchMs.push(await navigate(page, paths[index % paths.length]))
    }

    const result = {
      hardRefreshP95Ms: percentile(hardRefreshMs, 0.95),
      cachedSwitchP95Ms: percentile(cachedSwitchMs, 0.95),
      hardRefreshMs,
      cachedSwitchMs,
      budgets: { hardRefreshMs: HARD_REFRESH_BUDGET_MS, cachedSwitchMs: CACHED_SWITCH_BUDGET_MS },
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.hardRefreshP95Ms >= HARD_REFRESH_BUDGET_MS || result.cachedSwitchP95Ms >= CACHED_SWITCH_BUDGET_MS)
      process.exitCode = 1
  } finally {
    await browser?.close()
    await app?.stop()
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function seedSnapshot(page, projects, currentProjectId) {
  await page.evaluate(
    async ({ projects, currentProjectId }) => {
      const request = indexedDB.open('ai-ide-bootstrap', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('snapshots')) request.result.createObjectStore('snapshots')
      }
      const db = await new Promise((resolveOpen, reject) => {
        request.onsuccess = () => resolveOpen(request.result)
        request.onerror = () => reject(request.error)
      })
      const entry = { data: [], fetchedAt: Date.now(), lastAccessedAt: Date.now(), invalidated: false, error: null }
      const entries = Object.fromEntries(projects.map((project) => [project.id, entry]))
      const snapshot = {
        version: 1,
        savedAt: Date.now(),
        projects,
        currentProjectId,
        taskCache: { entries, requestSeqByScope: {} },
        agentCache: { entries, requestSeqByScope: {} },
        sessionListCache: { entries, requestSeqByScope: {} },
        activeSession: null,
      }
      const transaction = db.transaction('snapshots', 'readwrite')
      transaction.objectStore('snapshots').put(JSON.stringify(snapshot), 'current')
      await new Promise((resolveWrite, reject) => {
        transaction.oncomplete = resolveWrite
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
    },
    { projects, currentProjectId },
  )
}

function navigate(page, path) {
  return page.evaluate(
    (targetPath) =>
      new Promise((resolveNavigation, reject) => {
        if (location.pathname === targetPath) {
          resolveNavigation(0)
          return
        }
        const startedAt = performance.now()
        const timeout = setTimeout(() => {
          removeEventListener('ai-ide-route-commit', onCommit)
          reject(new Error(`Timed out waiting for route commit: ${targetPath}`))
        }, 5_000)
        const onCommit = (event) => {
          if (event.detail?.path !== targetPath) return
          clearTimeout(timeout)
          removeEventListener('ai-ide-route-commit', onCommit)
          resolveNavigation(performance.now() - startedAt)
        }
        addEventListener('ai-ide-route-commit', onCommit)
        history.pushState({}, '', targetPath)
        dispatchEvent(new PopStateEvent('popstate'))
      }),
    path,
  )
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)]
}

function httpBase(app) {
  const address = app.server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP server is not listening')
  return `http://127.0.0.1:${address.port}`
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
