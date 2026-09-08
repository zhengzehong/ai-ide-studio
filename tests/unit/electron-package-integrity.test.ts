import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateElectronModules, validatePackagedElectron, validatePackagedDependencies } from '../../scripts/electron-package-integrity.mjs'
import config from '../../scripts/electron-builder.mjs'
import mirror from '../../electron/builder.config.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'electron-integrity-'))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    const target = join(root, file)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}
test('rejects the released main importing an omitted node/ipc.js', () => {
  const root = fixture({ 'main.js': "import './node/ipc.js'" })
  expect(() => validateElectronModules(root)).toThrow('node/ipc.js')
})
test('checks nested imports, exports, dynamic imports and preload require', () => {
  for (const statement of ["import './missing.js'", "export * from './missing.js'", "import('./missing.js')", "require('./missing.js')"]) {
    const root = fixture({ 'main.js': "import './node/ipc.js'", 'node/ipc.js': statement })
    expect(() => validateElectronModules(root)).toThrow('missing.js')
  }
})
test('accepts cycles and ignores comments and runtime builtin imports', () => {
  const root = fixture({ 'main.js': "import './node/ipc.js'; // import './missing.js'", 'node/ipc.js': "import '../main.js'; import {app} from 'electron'; import 'node:fs'" })
  expect(validateElectronModules(root)).toBe(2)
})
test('both configs package nodes and enable assisted installation', () => {
  for (const item of [config, mirror]) {
    const electron = item.files.find((entry) => typeof entry !== 'string' && entry.to === 'electron/dist')
    expect(electron).toMatchObject({ filter: expect.arrayContaining(['node/**/*.js']) })
    expect(item.nsis).toMatchObject({ oneClick: false, allowToChangeInstallationDirectory: true })
  }
})
test('checks unimported preload files and rejects stale packaged code', () => {
  const root = fixture({ 'compiled/main.js': '', 'compiled/desktop-preload.cjs': 'require("electron")',
    'unpacked/resources/app/electron/dist/main.js': '' })
  const compiled = join(root, 'compiled')
  const unpacked = join(root, 'unpacked')
  expect(() => validatePackagedElectron(unpacked, compiled)).toThrow('desktop-preload.cjs')
  const preload = join(unpacked, 'resources/app/electron/dist/desktop-preload.cjs')
  writeFileSync(preload, 'old code')
  expect(() => validatePackagedElectron(unpacked, compiled)).toThrow('Stale')
  writeFileSync(preload, 'require("electron")')
  expect(validatePackagedElectron(unpacked, compiled)).toBe(2)
})
test('validates the backend bootstrap at its relocated package path', () => {
  const root = fixture({ 'compiled/main.js': '', 'compiled/backend-main.js': "import '../dist/app.js'",
    'unpacked/resources/app/electron/dist/main.js': '',
    'unpacked/resources/app/electron/backend-main.js': "import '../dist/app.js'" })
  expect(() => validatePackagedElectron(join(root, 'unpacked'), join(root, 'compiled'))).toThrow('../dist/app.js')
  mkdirSync(join(root, 'unpacked/resources/app/dist'))
  writeFileSync(join(root, 'unpacked/resources/app/dist/app.js'), '')
  expect(validatePackagedElectron(join(root, 'unpacked'), join(root, 'compiled'))).toBe(1)
})
test('rejects missing transitive packages instead of falling back to the build machine', () => {
  const root = fixture({ 'package.json': JSON.stringify({ name: 'app', dependencies: { pino: '*' } }),
    'node_modules/pino/package.json': JSON.stringify({ name: 'pino', dependencies: { 'sonic-boom': '*' } }) })
  expect(() => validatePackagedDependencies(root)).toThrow('pino -> sonic-boom')
  mkdirSync(join(root, 'node_modules/sonic-boom'))
  writeFileSync(join(root, 'node_modules/sonic-boom/package.json'), JSON.stringify({ name: 'sonic-boom' }))
  expect(validatePackagedDependencies(root)).toBe(3)
})
