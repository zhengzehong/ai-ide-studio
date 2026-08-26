import { wsClient } from './ws-client'

const RESOURCE_SCHEME = 'ai-ide-resource:'
const EXTERNAL_SCHEMES = /^(?:https?|mailto|tel):/i
const UNSAFE_SCHEMES = /^(?:javascript|data|vbscript):/i

export interface ChatResourceReference {
  path: string
  name: string
  kind: 'file' | 'directory'
  absolute: boolean
}

export type OpenChatResource = (reference: string) => Promise<ChatResourceReference>

export function isChatResourceReference(value: string): boolean {
  const reference = value.trim()
  if (!reference || reference.startsWith('#') || EXTERNAL_SCHEMES.test(reference) || UNSAFE_SCHEMES.test(reference)) {
    return false
  }
  return !/^[a-z][a-z0-9+.-]*:/i.test(reference)
    || /^[a-z]:[\\/]/i.test(reference)
    || /^file:/i.test(reference)
    || /^\\\\/.test(reference)
}

export function encodeChatResourceHref(reference: string): string {
  return `${RESOURCE_SCHEME}${encodeURIComponent(reference)}`
}

export function decodeChatResourceHref(href: string | undefined): string | null {
  if (!href?.startsWith(RESOURCE_SCHEME)) return null
  try {
    return decodeURIComponent(href.slice(RESOURCE_SCHEME.length))
  } catch {
    return null
  }
}

export async function resolveChatResource(projectId: string, reference: string): Promise<ChatResourceReference> {
  return await wsClient.request({ type: 'fs.resolveReference', projectId, reference }) as ChatResourceReference
}
