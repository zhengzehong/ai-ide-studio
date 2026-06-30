import { useMemo, type CSSProperties } from 'react'
import { Cpu, SlidersHorizontal } from 'lucide-react'
import type { SessionCapabilities } from '@desktop/stores/session-events'
import { displayConfigValue } from '@desktop/pages/workspace/helpers'
import FilterSelectSheet from '../FilterSelectSheet'
import ContextCircle from './ContextCircle'

interface Props {
  capabilities: SessionCapabilities
  onSetModel: (modelId: string) => void
  onSetMode: (modeId: string) => void
  onSetConfig: (configId: string, value: string | boolean) => void
}

// 配置区:模型/模式/二级配置(推理强度等)+ 总上下文用量,贴在 ChatInput 上方。
// 二级配置 filter 逻辑同 PC 端 Workspace.tsx:1370-1372(排除 model/mode)。
export default function ConfigToolbar({ capabilities, onSetModel, onSetMode, onSetConfig }: Props) {
  const modelOptions = useMemo(
    () => capabilities.models.map(m => ({ value: m.modelId, label: m.name || m.modelId })),
    [capabilities.models],
  )
  const modeOptions = useMemo(
    () => capabilities.modes.map(m => ({ value: m.modeId, label: m.name || m.modeId })),
    [capabilities.modes],
  )
  const secondaryConfigs = useMemo(
    () => capabilities.configOptions.filter(
      o => o.category !== 'model' && o.category !== 'mode' && o.id !== 'model' && o.id !== 'mode',
    ),
    [capabilities.configOptions],
  )

  return (
    <div style={styles.toolbar}>
      <FilterSelectSheet
        compact
        icon={<Cpu size={15} color="var(--primary)" />}
        title="选择模型"
        value={capabilities.currentModelId ?? ''}
        options={modelOptions}
        onChange={onSetModel}
      />
      <FilterSelectSheet
        compact
        icon={<SlidersHorizontal size={15} color="var(--primary)" />}
        title="模式"
        value={capabilities.currentModeId ?? ''}
        options={modeOptions}
        onChange={onSetMode}
      />
      {secondaryConfigs.map(opt => (
        <FilterSelectSheet
          key={opt.id}
          compact
          icon={<SlidersHorizontal size={15} color="var(--primary)" />}
          title={opt.name || opt.id}
          value={typeof opt.currentValue === 'string' ? opt.currentValue : ''}
          options={(opt.options ?? []).map(o => ({ value: o.value, label: displayConfigValue(o.value) || o.name }))}
          onChange={(value) => onSetConfig(opt.id, value)}
        />
      ))}
      <ContextCircle />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  toolbar: {
    display: 'flex',
    gap: 6,
    padding: '6px 12px',
    background: 'var(--bg-card)',
    flexShrink: 0,
    overflowX: 'auto',
    borderBottom: '1px solid var(--border-light)',
  },
}
