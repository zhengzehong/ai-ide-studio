import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  desktopArtifactNames,
  promoteDesktopRelease,
} from '../../scripts/desktop-release.mjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'ai-ide-desktop-release-'))
  temporaryDirectories.push(workspace)
  return workspace
}

function createStagedRelease(workspace: string, version = '0.2.0'): string {
  const stagingDir = join(workspace, '.electron-build', 'desktop-release-staging')
  const names = desktopArtifactNames(version)
  mkdirSync(join(stagingDir, names.unpackedDirectory), { recursive: true })
  writeFileSync(join(stagingDir, names.installer), 'new-installer')
  writeFileSync(join(stagingDir, names.portable), 'new-portable')
  writeFileSync(join(stagingDir, names.unpackedDirectory, 'AI IDE Studio.exe'), 'new-unpacked')
  writeFileSync(join(stagingDir, 'builder-debug.yml'), 'staging-metadata')
  return stagingDir
}

describe('desktop release promotion', () => {
  test('replaces desktop outputs while preserving APK files byte-for-byte', () => {
    const workspace = createWorkspace()
    const releaseDir = join(workspace, 'release')
    const stagingDir = createStagedRelease(workspace)
    mkdirSync(join(releaseDir, 'win-unpacked'), { recursive: true })
    writeFileSync(join(releaseDir, 'AI IDE Studio 0.2.0-auth-fix.exe'), 'old-portable')
    writeFileSync(join(releaseDir, 'AI IDE Studio Setup 0.2.0.exe.blockmap'), 'old-blockmap')
    writeFileSync(join(releaseDir, 'win-unpacked', 'old.txt'), 'old-unpacked')
    writeFileSync(join(releaseDir, 'AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk'), 'apk-content')

    const result = promoteDesktopRelease({ workspace, releaseDir, stagingDir, version: '0.2.0' })

    expect(readFileSync(join(releaseDir, 'AI-IDE-Studio-Mobile-prd-0.2.0-debug.apk'), 'utf8'))
      .toBe('apk-content')
    expect(readFileSync(result.installerPath, 'utf8')).toBe('new-installer')
    expect(readFileSync(result.portablePath, 'utf8')).toBe('new-portable')
    expect(readFileSync(join(result.unpackedPath, 'AI IDE Studio.exe'), 'utf8')).toBe('new-unpacked')
    expect(existsSync(join(releaseDir, 'AI IDE Studio 0.2.0-auth-fix.exe'))).toBe(false)
    expect(existsSync(join(releaseDir, 'AI IDE Studio Setup 0.2.0.exe.blockmap'))).toBe(false)
    expect(existsSync(stagingDir)).toBe(false)
  })

  test('keeps the previous desktop release when staging is incomplete', () => {
    const workspace = createWorkspace()
    const releaseDir = join(workspace, 'release')
    const stagingDir = join(workspace, '.electron-build', 'desktop-release-staging')
    mkdirSync(stagingDir, { recursive: true })
    mkdirSync(releaseDir, { recursive: true })
    writeFileSync(join(stagingDir, 'AI IDE Studio 0.2.0.exe'), 'portable-only')
    writeFileSync(join(releaseDir, 'AI IDE Studio 0.2.0.exe'), 'previous-portable')

    expect(() => promoteDesktopRelease({ workspace, releaseDir, stagingDir, version: '0.2.0' }))
      .toThrow(/Missing staged desktop artifact/)
    expect(readFileSync(join(releaseDir, 'AI IDE Studio 0.2.0.exe'), 'utf8'))
      .toBe('previous-portable')
  })

  test('rejects release paths outside the workspace', () => {
    const workspace = createWorkspace()
    const outside = createWorkspace()
    const stagingDir = createStagedRelease(workspace)

    expect(() => promoteDesktopRelease({
      workspace,
      releaseDir: join(outside, 'release'),
      stagingDir,
      version: '0.2.0',
    })).toThrow(/must stay inside the workspace/)
  })
})

describe('desktop packaging entry point', () => {
  test('exposes one canonical package command', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))

    expect(packageJson.scripts['package:desktop']).toBe('node scripts/build-desktop-release.mjs')
    expect(packageJson.scripts['build:desktop']).toBe('npm run package:desktop')
    expect(packageJson.scripts['build:electron']).toBe('npm run package:desktop')
  })

  test('allows Electron Builder output to be isolated in staging', async () => {
    const previous = process.env.AI_IDE_ELECTRON_OUTPUT_DIR
    process.env.AI_IDE_ELECTRON_OUTPUT_DIR = '.electron-build/test-staging'
    try {
      vi.resetModules()
      const module = await import('../../scripts/electron-builder.mjs')
      expect(module.default.directories.output).toBe('.electron-build/test-staging')
    } finally {
      if (previous === undefined) delete process.env.AI_IDE_ELECTRON_OUTPUT_DIR
      else process.env.AI_IDE_ELECTRON_OUTPUT_DIR = previous
    }
  })
})
