import { fingerprintRuntimeEnv } from '../../acp/model-profile-env.js'
import type { RuntimeStateSnapshot } from '../../ports/runtime-port.js'

export function runtimeAgentFingerprint(snapshot: RuntimeStateSnapshot): string {
  return stableStringify({
    runtime: snapshot.agent.runtime,
    command: snapshot.runtime.command ?? null,
    env: fingerprintRuntimeEnv(snapshot.runtime.env, snapshot.agent.runtime),
    gatewayAuth: snapshot.runtime.gatewayAuth?.fingerprint ?? null,
  })
}

export function runtimeSessionContextFingerprint(snapshot: RuntimeStateSnapshot): string {
  return stableStringify({
    projectId: snapshot.session.projectId,
    cwd: snapshot.session.cwd,
    isPrimary: snapshot.session.isPrimary,
    mcpServers: snapshot.mcpServers,
    sessionMeta: snapshot.runtime.sessionMeta ?? null,
    autoApprovedToolNames: [...snapshot.autoApprovedToolNames].sort(),
  })
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}
