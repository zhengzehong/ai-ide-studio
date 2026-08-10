import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const FILE_ASSET_URL_TTL_MS = 60 * 60 * 1000

export interface FileAssetUrlInput {
  projectId: string
  path: string
  mode: 'inline' | 'attachment'
}

export interface SignedFileAssetUrl {
  url: string
  expiresAt: number
  signature: string
}

let signingKey = randomBytes(32)

export function configureFileAssetSigning(secret?: string): void {
  signingKey = secret
    ? createHash('sha256').update(secret).digest()
    : randomBytes(32)
}

export function createFileAssetUrl(
  input: FileAssetUrlInput,
  options: { now?: number; ttlMs?: number } = {},
): SignedFileAssetUrl {
  const expiresAt = Math.floor((options.now ?? Date.now()) + (options.ttlMs ?? FILE_ASSET_URL_TTL_MS))
  const signature = sign(input, expiresAt)
  const params = new URLSearchParams({
    projectId: input.projectId,
    path: input.path,
    mode: input.mode,
    expires: String(expiresAt),
    signature,
  })
  return { url: `/api/fs/asset?${params.toString()}`, expiresAt, signature }
}

export function verifyFileAssetSignature(
  input: FileAssetUrlInput & { expiresAt: number; signature: string },
  now = Date.now(),
): 'valid' | 'expired' | 'invalid' {
  if (!Number.isSafeInteger(input.expiresAt) || !input.signature) return 'invalid'
  const expected = Buffer.from(sign(input, input.expiresAt), 'base64url')
  const received = Buffer.from(input.signature, 'base64url')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return 'invalid'
  return input.expiresAt < now ? 'expired' : 'valid'
}

function sign(input: FileAssetUrlInput, expiresAt: number): string {
  const payload = JSON.stringify([input.projectId, input.path, input.mode, expiresAt])
  return createHmac('sha256', signingKey).update(payload).digest('base64url')
}
