import { useState } from 'react'
import { Eye, EyeOff, Trash2, X } from 'lucide-react'
import type { SpreadsheetField, SpreadsheetSchema, SpreadsheetViewConfig } from '../../stores/spreadsheet.store'
import { nextOptionColor } from './spreadsheet-view'

const FIELD_TYPES: Array<{ type: SpreadsheetField['type']; label: string }> = [
  { type: 'text', label: '文本' },
  { type: 'number', label: '数字' },
  { type: 'singleSelect', label: '单选' },
  { type: 'date', label: '日期' },
  { type: 'checkbox', label: '勾选' },
]

interface FieldManagerModalProps {
  schema: SpreadsheetSchema
  view: SpreadsheetViewConfig
  onClose: () => void
  onApply: (schema: SpreadsheetSchema, view: SpreadsheetViewConfig) => void
}

/** 字段管理弹窗：显隐 / 改名 / 删除 / 添加字段（类型网格）/ 单选选项编辑（自动配色） */
export function FieldManagerModal({ schema, view, onClose, onApply }: FieldManagerModalProps) {
  const [draft, setDraft] = useState<SpreadsheetSchema>(() => ({
    fields: schema.fields.map((field) => ({ ...field, options: field.options?.map((option) => ({ ...option })) })),
  }))
  const [hidden, setHidden] = useState<string[]>(view.hidden ?? [])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<SpreadsheetField['type']>('text')
  const [newOptions, setNewOptions] = useState<string[]>([])

  function patchField(key: string, patch: Partial<SpreadsheetField>) {
    setDraft((prev) => ({
      fields: prev.fields.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    }))
  }

  function toggleHidden(key: string) {
    setHidden((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  function addField() {
    const name = newName.trim()
    if (!name) return
    const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `f-${Math.random().toString(36).slice(2, 10)}`
    if (draft.fields.some((field) => field.key === key)) {
      setNewName('')
      return
    }
    const field: SpreadsheetField = { key, name, type: newType, w: 120 }
    if (newType === 'singleSelect') {
      field.options = newOptions.map((option, index) => ({ n: option, c: nextOptionColor(index) }))
    }
    setDraft((prev) => ({ fields: [...prev.fields, field] }))
    setNewName('')
    setNewOptions([])
    setNewType('text')
    setAdding(false)
  }

  function removeField(key: string) {
    setDraft((prev) => ({ fields: prev.fields.filter((field) => field.key !== key) }))
  }

  function apply() {
    onApply(draft, { ...view, hidden: hidden.length > 0 ? hidden : undefined })
  }

  return (
    <div className="spx-modal-mask" onPointerDown={(event) => event.stopPropagation()}>
      <div className="spx-modal" role="dialog" aria-label="字段管理">
        <div className="spx-modal-head">
          <strong>字段管理</strong>
          <button type="button" className="spx-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="spx-modal-body">
          {draft.fields.map((field) => (
            <div key={field.key} className="spx-frow">
              <button
                type="button"
                className="spx-icon-btn"
                title={hidden.includes(field.key) ? '显示该列' : '隐藏该列'}
                onClick={() => toggleHidden(field.key)}
              >
                {hidden.includes(field.key) ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <span className="spx-ftype">{FIELD_TYPES.find((item) => item.type === field.type)?.label ?? field.type}</span>
              <input
                className="spx-frow-name"
                defaultValue={field.name}
                onBlur={(event) => {
                  const name = event.target.value.trim()
                  if (name && name !== field.name) patchField(field.key, { name })
                }}
              />
              <button type="button" className="spx-icon-btn" title="删除字段（数据保留可恢复）" onClick={() => removeField(field.key)}>
                <Trash2 size={13} />
              </button>
              {field.type === 'singleSelect' && (
                <div className="spx-opts">
                  {(field.options ?? []).map((option, index) => (
                    <span key={option.n} className={`spx-tag c-${option.c}`}>
                      {option.n}
                      <button
                        type="button"
                        className="spx-tag-x"
                        onClick={() =>
                          patchField(field.key, {
                            options: (field.options ?? []).filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <input
                    className="spx-opt-input"
                    placeholder="加选项回车"
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      const value = event.currentTarget.value.trim()
                      if (!value) return
                      const options = field.options ?? []
                      if (options.some((option) => option.n === value)) return
                      patchField(field.key, { options: [...options, { n: value, c: nextOptionColor(options.length) }] })
                      event.currentTarget.value = ''
                    }}
                  />
                </div>
              )}
            </div>
          ))}

          {adding ? (
            <div className="spx-addfield">
              <input
                autoFocus
                className="spx-frow-name"
                placeholder="字段名称"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addField()
                  if (event.key === 'Escape') setAdding(false)
                }}
              />
              <div className="spx-typegrid">
                {FIELD_TYPES.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className={`spx-type${newType === item.type ? ' on' : ''}`}
                    onClick={() => setNewType(item.type)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {newType === 'singleSelect' && (
                <div className="spx-opts">
                  {newOptions.map((option, index) => (
                    <span key={option} className={`spx-tag c-${nextOptionColor(index)}`}>
                      {option}
                      <button type="button" className="spx-tag-x" onClick={() => setNewOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <input
                    className="spx-opt-input"
                    placeholder="加选项回车"
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      const value = event.currentTarget.value.trim()
                      if (!value || newOptions.includes(value)) return
                      setNewOptions((prev) => [...prev, value])
                      event.currentTarget.value = ''
                    }}
                  />
                </div>
              )}
              <div className="spx-addfield-actions">
                <button type="button" className="spx-btn spx-btn--primary" onClick={addField}>
                  添加字段
                </button>
                <button type="button" className="spx-btn spx-btn--ghost" onClick={() => setAdding(false)}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="spx-btn spx-btn--ghost spx-addfield-btn" onClick={() => setAdding(true)}>
              + 添加字段
            </button>
          )}
        </div>
        <div className="spx-modal-foot">
          <button type="button" className="spx-btn spx-btn--primary" onClick={apply}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
