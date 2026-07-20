export function shouldShowAccessTokenPage(input: { connected: boolean; authRequired: boolean }): boolean {
  return input.authRequired
}
