import { rm, cp, readdir } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'

const root = resolve('references/projects')
const keep = join(root, 'AionUi')
const source = join(root, 'AionUi-source')

function assertInside(path) {
  const rel = relative(root, path)
  if (rel === '' || rel.startsWith('..') || resolve(path) === root) {
    throw new Error(`Refuse unsafe path: ${path}`)
  }
}

async function copyIfExists(from, to) {
  try {
    await cp(from, to, { force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

await copyIfExists(join(source, 'AIONUI_SOURCE_INFO.json'), join(keep, 'AIONUI_SOURCE_INFO.json'))
await copyIfExists(join(source, 'SOURCE-NOTES.md'), join(keep, 'SOURCE-NOTES.md'))

const targets = [
  join(root, 'AionUi-git'),
  join(root, 'AionUi-source'),
  join(root, 'git-write-test-mcp'),
  join(root, '_AionUi_failed_git_clone'),
  join(root, '.gitignore'),
  join(keep, 'SANDBOX-WRITE-TEST.txt'),
]

for (const target of targets) {
  assertInside(target)
  await rm(target, { recursive: true, force: true })
}

const entries = await readdir(root, { withFileTypes: true })
console.log(entries.map(entry => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n'))
