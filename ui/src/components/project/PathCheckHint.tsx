import type { CSSProperties } from 'react'
import type { PathCheckState } from './pathCheck'

export function PathCheckHint({ state }: { state: PathCheckState }) {
  if (state.state === 'idle') {
    return <div style={{ ...hintStyle, color: 'var(--text-3)' }}>手动输入完整路径,或从最近使用的路径中选择</div>
  }
  if (state.state === 'checking') {
    return <div style={{ ...hintStyle, color: 'var(--text-3)' }}>检查中...</div>
  }
  if (state.state === 'ok') {
    return <div style={{ ...hintStyle, color: 'var(--green)' }}>✓ 路径存在</div>
  }
  if (state.state === 'missing') {
    return <div style={{ ...hintStyle, color: 'var(--red)' }}>✗ 路径不存在(仍可强制保存)</div>
  }
  return <div style={{ ...hintStyle, color: 'var(--red)' }}>✗ {state.message}</div>
}

const hintStyle: CSSProperties = { fontSize: 11, marginTop: 4 }
