export function isAgentVisiblePlatformTool(_toolName: string): boolean {
  // Per-agent/project bindings are the exposure boundary. Team tools have no global binding.
  return true
}
