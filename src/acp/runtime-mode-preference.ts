const DEFAULT_MODE_BY_RUNTIME: Readonly<Record<string, string>> = {
  codex: 'agent-full-access',
  claude: 'bypassPermissions',
}

export function resolveDesiredRuntimeMode(runtime: string, savedModeId?: string): string | undefined {
  return savedModeId ?? DEFAULT_MODE_BY_RUNTIME[runtime]
}
