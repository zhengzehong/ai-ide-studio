export interface PermissionOptionLike {
  optionId: string
  name: string
  kind: string
}

const OPTION_LABELS: Record<string, string> = {
  allow_always: '始终允许',
  allow_once: '允许一次',
  reject_once: '拒绝',
  reject_always: '始终拒绝',
}

export function permissionOptionLabel(option: PermissionOptionLike): string {
  return OPTION_LABELS[option.kind] || OPTION_LABELS[option.optionId] || option.name
}

export function isAllowPermissionOption(option: PermissionOptionLike): boolean {
  return option.kind.startsWith('allow') || option.optionId.startsWith('allow')
}

export function isRejectAlwaysOption(option: PermissionOptionLike): boolean {
  return option.kind === 'reject_always'
}
