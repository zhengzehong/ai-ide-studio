import { useState } from 'react'
import { ModalOverlay } from '../../components/ModalDialog'
import type { AgentMemoryDimensionData } from '../../stores/agent-memory.store'

interface DimensionModalProps {
  open: boolean
  mode: 'create' | 'edit'
  dimension: AgentMemoryDimensionData | null
  saving: boolean
  onSave: (input: { name: string; description: string; prompt: string }) => Promise<void>
  onClose: () => void
}

export function DimensionModal({ open, mode, dimension, saving, onSave, onClose }: DimensionModalProps) {
  const initialName = dimension?.name ?? ''
  const initialDescription = dimension?.description ?? ''
  const initialPrompt = dimension?.prompt ?? ''
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [prompt, setPrompt] = useState(initialPrompt)

  const handleSave = async () => {
    if (!name.trim()) return
    await onSave({ name: name.trim(), description: description.trim(), prompt: prompt.trim() })
  }

  return (
    <ModalOverlay open={open} onClose={onClose} title={mode === 'edit' ? '编辑维度' : '新建维度'} width={520}>
      <div className="am-modal-field">
        <label>维度名</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 用户偏好" autoFocus />
      </div>
      <div className="am-modal-field">
        <label>说明</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="维度用途简述" />
      </div>
      <div className="am-modal-field">
        <label>Prompt(注入 System Prompt,含何时记录/何时使用/条目结构)</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={'何时记录: ...\n何时使用: ...\n条目结构: ...'}
        />
      </div>
      <div className="am-modal-actions">
        <button type="button" className="am-btn" onClick={onClose}>取消</button>
        <button type="button" className="am-btn am-btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
          保存
        </button>
      </div>
    </ModalOverlay>
  )
}
