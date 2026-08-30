import { CheckCheck, MoreHorizontal, Trash2, X } from 'lucide-react'

interface SessionBulkActionsProps {
  menuOpen: boolean
  batchMode: boolean
  selectedCount: number
  deletableCount: number
  allSelected: boolean
  busy: boolean
  confirmDelete: boolean
  notice: string | null
  error: string | null
  disabled?: boolean
  onToggleMenu: () => void
  onMarkRead: () => void
  onEnterDeleteMode: () => void
  onToggleSelectAll: () => void
  onRequestDelete: () => void
  onCancelMode: () => void
  onConfirmDelete: () => void
  onCancelConfirm: () => void
}

export function SessionBulkActions({
  menuOpen,
  batchMode,
  selectedCount,
  deletableCount,
  allSelected,
  busy,
  confirmDelete,
  notice,
  error,
  disabled = false,
  onToggleMenu,
  onMarkRead,
  onEnterDeleteMode,
  onToggleSelectAll,
  onRequestDelete,
  onCancelMode,
  onConfirmDelete,
  onCancelConfirm,
}: SessionBulkActionsProps) {
  return (
    <>
      {!batchMode ? (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onToggleMenu}
            title="批量会话操作"
            aria-label="批量会话操作"
            style={iconButtonStyle(menuOpen, disabled)}
            disabled={disabled}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={onToggleMenu} />
              <div style={menuStyle}>
                <button type="button" onClick={onMarkRead} style={menuItemStyle}>
                  <CheckCheck size={14} /> 批量标记已读
                </button>
                <button type="button" onClick={onEnterDeleteMode} style={menuItemStyle}>
                  <Trash2 size={14} /> 选择会话删除
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={batchToolbarStyle}>
          <label style={selectAllStyle}>
            <input type="checkbox" checked={allSelected && deletableCount > 0} onChange={onToggleSelectAll} disabled={deletableCount === 0 || busy} />
            <span>全选</span>
          </label>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}>已选 {selectedCount}</span>
          <button type="button" onClick={onRequestDelete} disabled={selectedCount === 0 || busy} title="删除选中的会话" aria-label="删除选中的会话" style={toolbarButtonStyle(selectedCount > 0)}>
            <Trash2 size={13} />
          </button>
          <button type="button" onClick={onCancelMode} disabled={busy} title="取消选择" aria-label="取消选择" style={toolbarButtonStyle(false)}>
            <X size={14} />
          </button>
        </div>
      )}
      {(notice || error) && (
        <div role={error ? 'alert' : 'status'} style={{ position: 'absolute', top: '100%', left: 8, right: 8, padding: '5px 7px', borderRadius: 4, background: error ? 'var(--red-light)' : 'var(--green-light)', color: error ? 'var(--red)' : 'var(--green)', fontSize: 11, zIndex: 5 }}>
          {error || notice}
        </div>
      )}
      {confirmDelete && (
        <div role="dialog" aria-modal="true" style={confirmBackdropStyle}>
          <div style={confirmCardStyle}>
            <strong style={{ color: 'var(--text-1)', fontSize: 13 }}>确认删除会话</strong>
            <p style={{ margin: '8px 0 14px', color: 'var(--text-2)', fontSize: 12, lineHeight: 1.5 }}>将删除 {selectedCount} 个会话，删除后它们会从当前列表中移除。</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button type="button" onClick={onCancelConfirm} disabled={busy} style={secondaryButtonStyle}>取消</button>
              <button type="button" onClick={onConfirmDelete} disabled={busy} style={dangerButtonStyle}>{busy ? '删除中...' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function iconButtonStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 22,
    padding: 0, border: 'none', background: active ? 'var(--blue-light)' : 'transparent',
    color: active ? 'var(--blue)' : 'var(--text-3)', cursor: disabled ? 'default' : 'pointer', borderRadius: 4,
    opacity: disabled ? 0.5 : 1,
  }
}

const menuStyle: React.CSSProperties = { position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: 150, padding: 4, background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 24px rgba(15,23,42,0.14)', zIndex: 999 }
const menuItemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '7px 9px', border: 'none', background: 'transparent', color: 'var(--text-1)', fontSize: 12, textAlign: 'left', cursor: 'pointer', borderRadius: 4 }
const batchToolbarStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }
const selectAllStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--text-2)', fontSize: 11, cursor: 'pointer' }
const toolbarButtonStyle = (active: boolean): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, padding: 0, border: 'none', borderRadius: 4, background: active ? 'var(--red-light)' : 'transparent', color: active ? 'var(--red)' : 'var(--text-3)', cursor: active ? 'pointer' : 'default', opacity: active ? 1 : 0.65 })
const confirmBackdropStyle: React.CSSProperties = { position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,0.24)', zIndex: 1200 }
const confirmCardStyle: React.CSSProperties = { width: 260, padding: 16, background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)' }
const secondaryButtonStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 5, background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 12, cursor: 'pointer' }
const dangerButtonStyle: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--red)', borderRadius: 5, background: 'var(--red)', color: '#fff', fontSize: 12, cursor: 'pointer' }
