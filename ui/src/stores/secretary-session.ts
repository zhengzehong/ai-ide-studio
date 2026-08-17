export type SecretarySessionPurpose = 'secretary_runtime' | 'secretary_chat'

export function isSecretarySessionPurpose(value: unknown): value is SecretarySessionPurpose {
  return value === 'secretary_runtime' || value === 'secretary_chat'
}
