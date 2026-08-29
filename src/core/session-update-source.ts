export type SessionUpdateSource = 'runtime-persistence' | 'platform-reconciliation' | 'platform-synthetic'

export function isPlatformSupplementSource(source: SessionUpdateSource | undefined): boolean {
  return source === 'platform-reconciliation' || source === 'platform-synthetic'
}
