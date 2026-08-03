import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promoteDesktopRelease } from './desktop-release.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseDir = join(root, 'release')
const stagingDir = join(root, '.electron-build', 'desktop-release-staging')
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = String(packageJson.version)

try {
  rmSync(stagingDir, { recursive: true, force: true })
  runNpm(['run', 'build'])
  runNpm(['run', 'build:electron:main'])
  runNode([
    'node_modules/electron-builder/out/cli/cli.js',
    '--config',
    'scripts/electron-builder.mjs',
  ], { AI_IDE_ELECTRON_OUTPUT_DIR: stagingDir })

  const artifacts = promoteDesktopRelease({ workspace: root, releaseDir, stagingDir, version })
  await printReleaseSummary(artifacts)
} catch (error) {
  process.stderr.write(`\nDesktop package failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

function runNpm(args) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  run(command, args, {}, process.platform === 'win32')
}

function runNode(args, extraEnv = {}) {
  run(process.execPath, args, extraEnv, false)
}

function run(command, args, extraEnv, shell) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    shell,
    stdio: 'inherit',
  })
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
  }
}

async function printReleaseSummary({ installerPath, portablePath, unpackedPath }) {
  const unpackedExecutable = join(unpackedPath, 'AI IDE Studio.exe')
  const rows = [
    await describeFile('Installer', installerPath),
    await describeFile('Portable', portablePath),
    await describeDirectory('Unpacked', unpackedPath, unpackedExecutable),
  ]
  process.stdout.write('\nDesktop release complete. Existing APK files were preserved.\n')
  for (const row of rows) {
    process.stdout.write(`${row.label}: ${row.path}\n`)
    process.stdout.write(`  Size: ${row.size} bytes\n`)
    process.stdout.write(`  SHA256: ${row.sha256}\n`)
  }
}

async function describeFile(label, path) {
  if (!existsSync(path)) throw new Error(`Missing promoted artifact: ${path}`)
  return { label, path, size: statSync(path).size, sha256: await sha256(path) }
}

async function describeDirectory(label, path, executablePath) {
  if (!existsSync(executablePath)) throw new Error(`Missing unpacked executable: ${executablePath}`)
  return {
    label,
    path,
    size: directorySize(path),
    sha256: `${await sha256(executablePath)} (AI IDE Studio.exe)`,
  }
}

function directorySize(path) {
  let size = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name)
    size += entry.isDirectory() ? directorySize(entryPath) : statSync(entryPath).size
  }
  return size
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex').toUpperCase()))
  })
}
