import { type CSSProperties } from 'react'
import { ModalOverlay } from '../../components/ModalDialog'
import type { ShareRow } from '../../services/share-api'

type ConfirmKind = 'revoke' | 'renew' | 'delete' | 'regen'

interface ConfirmDialogProps {
  action: { kind: ConfirmKind; share: ShareRow }
  onCancel: () => void
  onConfirm: () => void
}

const TITLE_MAP: Record<ConfirmKind, string> = {
  revoke: '撤销分享',
  renew: '续期分享',
  delete: '删除分享',
  regen: '重新生成分享',
}

const TEXT_MAP: Record<ConfirmKind, string> = {
  revoke: '撤销后链接立即失效,访客会断开,确定撤销?',
  renew: '续期 7 天?',
  delete: '删除后无法恢复,确定删除?',
  regen: '重新生成会用原参数创建新分享,旧链接立即失效,确定?',
}

export function ConfirmDialog({ action, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <ModalOverlay open onClose={onCancel} title={TITLE_MAP[action.kind]} width={420}>
      <div style={styles.body}>
        <div style={styles.text}>{TEXT_MAP[action.kind]}</div>
        <div style={styles.name}>{action.share.share_name}</div>
        <div style={styles.actions}>
          <button type="button" onClick={onCancel} style={styles.cancelBtn}>取消</button>
          <button type="button" onClick={onConfirm} style={styles.confirmBtn}>确认</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

const styles: Record<string, CSSProperties> = {
  body: { display: 'flex', flexDirection: 'column', gap: 12, padding: 4 },
  text: { fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6 },
  name: { fontSize: 13, color: 'var(--text-3)', padding: '6px 10px', background: 'var(--bg-1)', borderRadius: 6 },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  cancelBtn: { padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' },
  confirmBtn: { padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
}
