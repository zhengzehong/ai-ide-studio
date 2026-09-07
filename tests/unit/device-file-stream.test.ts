import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { resolveDeviceServerSource, snapshotDeviceFile, storeDeviceStream } from '../../src/devices/file-stream.js'

let directory: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'device-file-')); mkdirSync(join(directory, 'project')) })
afterEach(() => rmSync(directory, { force: true, recursive: true }))

describe('device file stream boundaries', () => {
  it('rejects outside paths and symlink escapes after realpath resolution', async () => {
    const outside = join(directory, 'secret.txt')
    writeFileSync(outside, 'private')
    const project = join(directory, 'project')
    await expect(resolveDeviceServerSource(project, '../secret.txt')).rejects.toThrow('超出')
    await expect(resolveDeviceServerSource(project, outside)).rejects.toThrow('超出')
    symlinkSync(directory, join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(resolveDeviceServerSource(project, 'escape/secret.txt')).rejects.toThrow('超出')
  })

  it('snapshots files with SHA256 and enforces byte limits without buffering full files', async () => {
    const source = join(directory, 'project', 'file.txt')
    writeFileSync(source, 'abcdef')
    const target = join(directory, 'snapshot')
    expect(await snapshotDeviceFile(source, target, 6)).toMatchObject({ size: 6, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(readFileSync(target, 'utf8')).toBe('abcdef')
    await expect(storeDeviceStream(Readable.from([Buffer.alloc(4), Buffer.alloc(4)]), join(directory, 'too-big'), 7)).rejects.toThrow('大小限制')
    expect(await storeDeviceStream(Readable.from([]), join(directory, 'empty'), 7)).toMatchObject({ size: 0 })
  })
})
