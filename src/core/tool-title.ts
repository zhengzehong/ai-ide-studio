const GENERIC_TOOL_TITLE_PREFIXES = [
  '工具调用',
  '宸ュ叿璋冪敤',
  'Tool call',
  'tool call',
]

export function isGenericToolTitle(title?: string | null): boolean {
  const value = title?.trim()
  if (!value) return true
  return GENERIC_TOOL_TITLE_PREFIXES.some((prefix) => value === prefix || value.startsWith(`${prefix} #`))
}

export function hasMeaningfulToolTitle(title?: string | null): title is string {
  return !!title && !isGenericToolTitle(title)
}
