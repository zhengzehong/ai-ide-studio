import { useEffect, useState, type CSSProperties } from 'react'
import { Check, X } from 'lucide-react'
import { useModelProfileStore, type ModelProfileRuntime } from '../../stores/model-profile.store'
import type { AgentItem } from '../../stores/app.store'
import { filterEnabledProfiles, parseAgentProfile, profileModelLabel, type ModelProfileMode } from '../../utils/model-profile'
import { showToast } from '../../utils/toast'

type AgentSheetAgent = Pick<AgentItem, 'id' | 'name' | 'runtime' | 'config_json'>

export function AgentProfileSheet({ agent, onClose }: { agent: AgentSheetAgent | null; onClose: () => void }) {
  const profiles = useModelProfileStore((state) => state.profiles)
  const globalProfiles = useModelProfileStore((state) => state.globalProfiles)
  const fetchAll = useModelProfileStore((state) => state.fetchAll)
  const updateAgentProfile = useModelProfileStore((state) => state.updateAgentProfile)
  const [mode, setMode] = useState<ModelProfileMode>('global')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!agent) return
    const parsed = parseAgentProfile(agent.config_json)
    setMode(parsed.mode)
    void fetchAll()
  }, [agent, fetchAll])

  if (!agent) return null

  const runtime: ModelProfileRuntime = agent.runtime === 'codex' ? 'codex' : 'claude'
  const options = filterEnabledProfiles(profiles, runtime)
  const current = parseAgentProfile(agent.config_json)

  const save = async (nextMode: ModelProfileMode, profileId: string | null): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      await updateAgentProfile(agent.id, nextMode, profileId)
      showToast('模型档案已更新')
      onClose()
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败,请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SheetFrame title={`模型档案 · ${agent.name}`} onClose={onClose}>
      <OptionRow
        label="跟随全局档案"
        sub={globalSummary(globalProfiles[runtime])}
        selected={mode === 'global'}
        disabled={saving}
        onClick={() => void save('global', null)}
      />
      <OptionRow
        label="固定档案"
        sub={mode === 'fixed' ? '选择下方档案' : undefined}
        selected={mode === 'fixed'}
        disabled={saving}
        onClick={() => setMode('fixed')}
      />
      {mode === 'fixed' && (
        <div style={styles.fixedList}>
          {options.length === 0 ? (
            <div style={styles.fixedEmpty}>该运行时暂无已启用的档案,可到 PC 端设置里新建</div>
          ) : (
            options.map((profile) => (
              <ProfileRow
                key={profile.id}
                label={profile.name}
                sub={profileModelLabel(profile.config_json)}
                selected={profile.id === (mode === 'fixed' ? current.profileId : null)}
                disabled={saving}
                onClick={() => void save('fixed', profile.id)}
              />
            ))
          )}
        </div>
      )}
      <OptionRow
        label="使用系统配置"
        sub="不指定档案"
        selected={mode === 'system'}
        disabled={saving}
        onClick={() => void save('system', null)}
      />
    </SheetFrame>
  )
}

function globalSummary(global: { enabled: boolean; profileId: string | null; profile: { name: string } | null } | null): string {
  if (global?.enabled && global.profile) return `全局:${global.profile.name}`
  return '全局:未启用'
}

export function GlobalProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profiles = useModelProfileStore((state) => state.profiles)
  const globalProfiles = useModelProfileStore((state) => state.globalProfiles)
  const fetchAll = useModelProfileStore((state) => state.fetchAll)
  const setGlobalProfile = useModelProfileStore((state) => state.setGlobalProfile)
  const clearGlobalProfile = useModelProfileStore((state) => state.clearGlobalProfile)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) void fetchAll()
  }, [open, fetchAll])

  if (!open) return null

  const apply = async (runtime: ModelProfileRuntime, profileId: string | null): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      if (profileId) await setGlobalProfile(runtime, profileId)
      else await clearGlobalProfile(runtime)
      showToast('全局档案已更新,下一轮请求生效')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '保存失败,请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SheetFrame title="全局模型档案" onClose={onClose}>
      <RuntimeSection runtime="claude" label="Claude Code" />
      <RuntimeSection runtime="codex" label="Codex" />
    </SheetFrame>
  )

  function RuntimeSection({ runtime, label }: { runtime: ModelProfileRuntime; label: string }) {
    const current = globalProfiles[runtime]
    const options = filterEnabledProfiles(profiles, runtime)
    return (
      <div style={styles.runtimeSection}>
        <div style={styles.runtimeLabel}>{label}</div>
        <OptionRow
          label="不启用全局档案"
          selected={!current?.enabled}
          disabled={saving}
          onClick={() => void apply(runtime, null)}
        />
        {options.length === 0 ? (
          <div style={styles.fixedEmpty}>暂无已启用的档案,可到 PC 端设置里新建</div>
        ) : (
          options.map((profile) => (
            <ProfileRow
              key={profile.id}
              label={profile.name}
              sub={profileModelLabel(profile.config_json)}
              selected={!!current?.enabled && current.profileId === profile.id}
              disabled={saving}
              onClick={() => void apply(runtime, profile.id)}
            />
          ))
        )}
      </div>
    )
  }
}

/** 展示用的选项行,独立导出便于测试 */
export function ProfileRow({ label, sub, selected, disabled, onClick }: {
  label: string
  sub?: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="pressable"
      style={styles.optionRow}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span style={styles.checkCol}>{selected && <Check size={16} color="var(--primary)" strokeWidth={2.4} />}</span>
      <span style={styles.optionMain}>
        <span style={styles.optionLabel}>{label}</span>
        {sub && <span style={styles.optionSub}>{sub}</span>}
      </span>
    </button>
  )
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
          <button type="button" style={styles.closeButton} aria-label="关闭" onClick={onClose}>
            <X size={17} color="var(--text-muted)" />
          </button>
        </div>
        <div style={styles.body}>{children}</div>
      </div>
    </div>
  )
}

function OptionRow({ label, sub, selected, disabled, onClick }: {
  label: string
  sub?: string
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return <ProfileRow label={label} sub={sub} selected={selected} disabled={disabled} onClick={onClick} />
}

const styles: Record<string, CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end' },
  sheet: { width: '100%', maxHeight: '72vh', background: 'var(--bg-card)', borderRadius: '16px 16px 0 0', display: 'flex', flexDirection: 'column', paddingBottom: 'var(--safe-bottom)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '0.5px solid var(--border-light)' },
  title: { fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10 },
  closeButton: { border: 'none', background: 'transparent', padding: 4, display: 'flex', cursor: 'pointer', flexShrink: 0 },
  body: { overflowY: 'auto', padding: '6px 16px 18px' },
  runtimeSection: { marginTop: 8 },
  runtimeLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', margin: '8px 0 2px' },
  optionRow: { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 4px', border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', borderBottom: '0.5px solid var(--border-light)' },
  checkCol: { width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  optionMain: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  optionLabel: { fontSize: 14, color: 'var(--text-primary)' },
  optionSub: { fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fixedList: { margin: '2px 0 2px 26px' },
  fixedEmpty: { padding: '10px 4px', fontSize: 12, color: 'var(--text-muted)' },
}
