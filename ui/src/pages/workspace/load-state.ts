export type WorkspaceLoadState = 'loading' | 'error' | 'empty' | 'ready'

export function resolveWorkspaceLoadState(input: {
  loading: boolean
  error: string | null
  itemCount: number
}): WorkspaceLoadState {
  if (input.itemCount > 0) return 'ready'
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  return 'empty'
}
