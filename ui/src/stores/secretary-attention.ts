export interface SecretaryAttentionSource {
  unreadCount: number
  chatUnread: boolean
}

export function secretaryAttentionCount(secretary: SecretaryAttentionSource): number {
  return Math.max(0, secretary.unreadCount) + (secretary.chatUnread ? 1 : 0)
}

export function totalSecretaryAttention(secretaries: SecretaryAttentionSource[]): number {
  return secretaries.reduce((total, secretary) => total + secretaryAttentionCount(secretary), 0)
}
