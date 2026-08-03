import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

const DESKTOP_METADATA_FILES = new Set([
  'builder-debug.yml',
  'builder-effective-config.yaml',
  'latest.yml',
])

export function desktopArtifactNames(version) {
  return {
    installer: `AI IDE Studio Setup ${version}.exe`,
    portable: `AI IDE Studio ${version}.exe`,
    unpackedDirectory: 'win-unpacked',
  }
}

export function promoteDesktopRelease({ workspace, releaseDir, stagingDir, version }) {
  const safeReleaseDir = assertWorkspaceChild(workspace, releaseDir, 'Release directory')
  const safeStagingDir = assertWorkspaceChild(workspace, stagingDir, 'Staging directory')
  const names = desktopArtifactNames(version)
  const stagedInstaller = join(safeStagingDir, names.installer)
  const stagedPortable = join(safeStagingDir, names.portable)
  const stagedUnpacked = join(safeStagingDir, names.unpackedDirectory)
  const stagedUnpackedExecutable = join(stagedUnpacked, 'AI IDE Studio.exe')

  for (const path of [stagedInstaller, stagedPortable, stagedUnpacked, stagedUnpackedExecutable]) {
    if (!existsSync(path)) throw new Error(`Missing staged desktop artifact: ${path}`)
  }

  mkdirSync(safeReleaseDir, { recursive: true })
  cleanDesktopRelease(safeReleaseDir)

  const installerPath = join(safeReleaseDir, names.installer)
  const portablePath = join(safeReleaseDir, names.portable)
  const unpackedPath = join(safeReleaseDir, names.unpackedDirectory)
  renameSync(stagedInstaller, installerPath)
  renameSync(stagedPortable, portablePath)
  renameSync(stagedUnpacked, unpackedPath)
  rmSync(safeStagingDir, { recursive: true, force: true })

  return { installerPath, portablePath, unpackedPath }
}

export function cleanDesktopRelease(releaseDir) {
  if (!existsSync(releaseDir)) return
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!isDesktopReleaseEntry(entry.name, entry.isDirectory())) continue
    rmSync(join(releaseDir, entry.name), { recursive: entry.isDirectory(), force: true })
  }
}

function isDesktopReleaseEntry(name, isDirectory) {
  if (isDirectory) return name === 'win-unpacked' || name === '.icon-ico'
  if (DESKTOP_METADATA_FILES.has(name)) return true
  if (/^AI IDE Studio.*\.exe(?:\.blockmap)?$/i.test(name)) return true
  return /^ai-ide-studio-.*\.nsis\.7z$/i.test(name)
}

function assertWorkspaceChild(workspace, target, label) {
  const workspacePath = resolve(workspace)
  const targetPath = resolve(target)
  const relativePath = relative(workspacePath, targetPath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the workspace: ${targetPath}`)
  }
  return targetPath
}
