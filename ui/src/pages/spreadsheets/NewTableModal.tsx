import { useState } from 'react'
import { X } from 'lucide-react'

interface NewTableModalProps {
  onClose: () => void
  onCreate: (title: string) => void
}

/** 新建表格弹窗：只填标题，服务端落默认 3 字段（标题/状态/日期） */
export function NewTableModal({ onClose, onCreate }: NewTableModalProps) {
  const [title, setTitle] = useState('')

  function submit() {
    const name = title.trim()
    if (!name) return
    onCreate(name)
  }

  return (
    <div className="spx-modal-mask" onPointerDown={(event) => event.stopPropagation()}>
      <div className="spx-modal spx-modal--narrow" role="dialog" aria-label="新建表格">
        <div className="spx-modal-head">
          <strong>新建表格</strong>
          <button type="button" className="spx-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="spx-modal-body">
          <input
            autoFocus
            className="spx-frow-name"
            placeholder="表格标题，如：bug 清单"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
              if (event.key === 'Escape') onClose()
            }}
          />
          <p className="spx-hint">默认带 3 个字段：标题（文本）、状态（单选）、日期；创建后可在「字段管理」里调整。</p>
        </div>
        <div className="spx-modal-foot">
          <button type="button" className="spx-btn spx-btn--primary" onClick={submit} disabled={!title.trim()}>
            创建
          </button>
        </div>
      </div>
    </div>
  )
}
