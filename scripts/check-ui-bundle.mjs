import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_ENTRY_BYTES = 450 * 1024
const MIN_DYNAMIC_ROUTE_COUNT = 15

export function assessBundleManifest(manifest, fileSizes, options = {}) {
  const maxEntryBytes = options.maxEntryBytes ?? MAX_ENTRY_BYTES
  const minDynamicRouteCount = options.minDynamicRouteCount ?? MIN_DYNAMIC_ROUTE_COUNT
  const entries = Object.entries(manifest)
  const main = entries.find(([, item]) => isRecord(item) && item.isEntry === true)
  if (!main || !isRecord(main[1]) || typeof main[1].file !== 'string') {
    throw new Error('UI manifest 缺少主入口')
  }
  const entryBytes = fileSizes[main[1].file]
  if (!Number.isFinite(entryBytes)) throw new Error(`UI 入口文件不存在: ${main[1].file}`)
  if (entryBytes > maxEntryBytes) {
    throw new Error(`UI 入口 chunk 超过预算: ${entryBytes} > ${maxEntryBytes} bytes`)
  }
  const dynamicRouteCount = entries.filter(([source, item]) => (
    source.includes('src/pages/') && isRecord(item) && item.isDynamicEntry === true
  )).length
  if (dynamicRouteCount < minDynamicRouteCount) {
    throw new Error(`UI 动态页面 chunk 数量不足: ${dynamicRouteCount} < ${minDynamicRouteCount}`)
  }
  return { entryBytes, dynamicRouteCount }
}

function run() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const dist = resolve(root, 'ui/dist')
  const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'))
  const fileSizes = Object.fromEntries(Object.values(manifest)
    .filter((item) => isRecord(item) && typeof item.file === 'string')
    .map((item) => [item.file, statSync(resolve(dist, item.file)).size]))
  const result = assessBundleManifest(manifest, fileSizes)
  process.stdout.write(
    `UI bundle gate passed: entry=${formatKiB(result.entryBytes)}, dynamicRoutes=${result.dynamicRouteCount}\n`,
  )
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run()
