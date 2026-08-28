import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bluetooth, Bot, ChevronRight, Info, LogOut, Mic, Server, Settings, Sparkles, Volume2, Wifi, WifiOff } from 'lucide-react'
import { useConnectionStore } from '../stores/connection.store'
import { useAppStore } from '../stores/app.store'
import { useSessionStore } from '../stores/session.store'
import { useVoiceStore, voiceAudioRouteLabel, voiceStateLabel } from '../stores/voice.store'
import { GlobalProfileSheet } from '../components/settings/ModelProfileSheets'
import { showToast } from '../utils/toast'

export default function SettingsPage() {
  const { serverUrl, token, connected, status, disconnect } = useConnectionStore()
  const { projects, agents, fetchAgents } = useAppStore()
  const { sessions, fetchSessions } = useSessionStore()
  const {
    enabled,
    state: voiceState,
    message: voiceMessage,
    audioRoute,
    audioDevice,
    projectId,
    agentId,
    sessionId,
    hydrated,
    hydrate,
    setTarget,
    start,
    stop,
  } = useVoiceStore()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [globalProfileOpen, setGlobalProfileOpen] = useState(false)
  const statusText = status === 'connecting' ? '连接中' : connected ? '已连接' : status === 'failed' ? '连接失败' : '未连接'
  const statusColor = connected ? 'var(--success)' : status === 'connecting' ? 'var(--warning)' : 'var(--error)'

  useEffect(() => {
    if (!hydrated) void hydrate()
  }, [hydrate, hydrated])

  useEffect(() => {
    if (!projectId) return
    void fetchAgents(projectId)
    void fetchSessions(projectId)
  }, [fetchAgents, fetchSessions, projectId])

  const projectAgents = useMemo(() => agents, [agents])
  const targetSessions = useMemo(
    () => sessions.filter((session) => session.status === 'active'
      && session.activityState !== 'running'
      && (!agentId || session.agentId === agentId)),
    [agentId, sessions],
  )
  const selectedProjectName = projects.find((project) => project.id === projectId)?.name ?? '未选择项目'
  const selectedAgentName = agents.find((agent) => agent.id === agentId)?.name ?? '未选择 Agent'
  const selectedSessionName = sessions.find((session) => session.id === sessionId)?.sessionTitle || sessionId || '未选择会话'

  const updateTarget = async (next: { projectId?: string; agentId?: string; sessionId?: string }) => {
    if (enabled) await stop()
    setTarget(next)
  }

  const handleProjectChange = async (nextProjectId: string) => {
    await updateTarget({ projectId: nextProjectId, agentId: '', sessionId: '' })
  }

  const handleAgentChange = async (nextAgentId: string) => {
    await updateTarget({ agentId: nextAgentId, sessionId: '' })
  }

  const handleVoiceToggle = async () => {
    setBusy(true)
    try {
      if (enabled) {
        await stop()
      } else {
        await start()
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '实时对话操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <Settings size={20} color="var(--primary)" />
        <span style={styles.headerTitle}>设置</span>
      </div>

      <div style={styles.content}>
        <div style={styles.section}>
          <div style={styles.sectionTitle}>实时语音对话</div>
          <div style={styles.card}>
            <div style={styles.voiceIntro}>
              <div style={styles.voiceIcon}><Mic size={20} color="var(--primary)" /></div>
              <div style={styles.voiceCopy}>
                <strong>后台实时对话</strong>
                <span>锁屏后继续监听，AI 回复由系统语音播放</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                disabled={busy || !connected || !projectId || !agentId || !sessionId
                  || !targetSessions.some((session) => session.id === sessionId)}
                onClick={() => void handleVoiceToggle()}
                style={{ ...styles.toggle, ...(enabled ? styles.toggleOn : {}), ...(busy ? styles.disabled : {}) }}
              >
                <span style={{ ...styles.toggleThumb, ...(enabled ? styles.toggleThumbOn : {}) }} />
              </button>
            </div>
            <div style={styles.divider} />
            <label style={styles.field}>
              <span style={styles.fieldLabel}>项目</span>
              <select value={projectId ?? ''} onChange={(event) => void handleProjectChange(event.target.value)} disabled={enabled || busy} style={styles.select}>
                <option value="">选择项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Agent</span>
              <select value={agentId ?? ''} onChange={(event) => void handleAgentChange(event.target.value)} disabled={!projectId || enabled || busy} style={styles.select}>
                <option value="">选择 Agent</option>
                {projectAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </label>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>会话</span>
              <select value={sessionId ?? ''} onChange={(event) => void updateTarget({ sessionId: event.target.value })} disabled={!agentId || enabled || busy} style={styles.select}>
                <option value="">选择活动会话</option>
                {targetSessions.map((session) => <option key={session.id} value={session.id}>{session.sessionTitle || `${session.agentName} · ${session.id.slice(0, 8)}`}</option>)}
              </select>
            </label>
            <div style={styles.targetSummary}>
              <span><strong>{selectedProjectName}</strong> · {selectedAgentName}</span>
              <span>{selectedSessionName}</span>
            </div>
            <div style={styles.voiceStatus}>
              <span style={{ ...styles.statusDot, background: voiceState === 'error' ? 'var(--error)' : enabled ? 'var(--success)' : 'var(--text-muted)' }} />
              <span>{voiceStateLabel(voiceState)}</span>
              <span style={styles.statusHint}>{voiceMessage || voiceAudioRouteLabel(audioRoute, audioDevice)}</span>
            </div>
            <div style={styles.audioHint}><Bluetooth size={14} /><Volume2 size={14} /><span>{voiceAudioRouteLabel(audioRoute, audioDevice)} · 系统自动选择</span></div>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>模型</div>
          <div style={styles.card}>
            <button className="pressable" style={styles.row} onClick={() => setGlobalProfileOpen(true)}>
              <Bot size={16} color="var(--primary)" />
              <span style={styles.label}>全局模型档案</span>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>会话模板</div>
          <div style={styles.card}>
            <button className="pressable" style={styles.row} onClick={() => navigate('/templates')}>
              <Sparkles size={16} color="var(--primary)" />
              <span style={styles.label}>模板管理</span>
              <ChevronRight size={16} color="var(--text-muted)" />
            </button>
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>服务器连接</div>
          <div style={styles.card}>
            <div style={styles.row}><Server size={16} color="var(--text-secondary)" /><span style={styles.label}>地址</span><span style={styles.value}>{serverUrl || '未配置'}</span></div>
            <div style={styles.divider} />
            <div style={styles.row}>{connected ? <Wifi size={16} color="var(--success)" /> : <WifiOff size={16} color={statusColor} />}<span style={styles.label}>状态</span><span style={{ ...styles.value, color: statusColor }}>{statusText}</span></div>
            {token && <><div style={styles.divider} /><div style={styles.row}><Info size={16} color="var(--text-secondary)" /><span style={styles.label}>Token</span><span style={styles.value}>{'•'.repeat(Math.min(token.length, 12))}</span></div></>}
          </div>
        </div>

        <div style={styles.section}>
          <div style={styles.sectionTitle}>操作</div>
          <div style={styles.card}><button className="pressable" style={styles.dangerRow} onClick={disconnect}><LogOut size={16} color="var(--error)" /><span style={{ color: 'var(--error)', fontSize: 14 }}>断开连接</span></button></div>
        </div>
        <div style={styles.version}>AI IDE Studio Mobile v0.2.0</div>
      </div>

      <GlobalProfileSheet open={globalProfileOpen} onClose={() => setGlobalProfileOpen(false)} />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)' },
  header: { display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 8px', paddingTop: 'calc(14px + var(--safe-top))', flexShrink: 0 },
  headerTitle: { fontSize: 21, fontWeight: 700, color: 'var(--text-primary)' },
  content: { flex: 1, overflowY: 'auto', padding: '8px 16px 16px' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, paddingLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  card: { background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' },
  voiceIntro: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px' },
  voiceIcon: { width: 38, height: 38, borderRadius: 10, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  voiceCopy: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  voiceCopyStrong: { fontSize: 15 },
  voiceCopySpan: { fontSize: 12, color: 'var(--text-muted)' },
  toggle: { width: 48, height: 28, borderRadius: 14, background: 'var(--border)', padding: 3, flexShrink: 0, transition: 'background .2s' },
  toggleOn: { background: 'var(--success)' },
  toggleThumb: { display: 'block', width: 22, height: 22, borderRadius: '50%', background: '#fff', transition: 'transform .2s' },
  toggleThumbOn: { transform: 'translateX(20px)' },
  disabled: { opacity: 0.5 },
  field: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' },
  fieldLabel: { width: 54, color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0 },
  select: { minWidth: 0, flex: 1, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-input)', color: 'var(--text-primary)', padding: '8px 10px', fontSize: 14 },
  targetSummary: { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 14px 10px', color: 'var(--text-secondary)', fontSize: 12 },
  voiceStatus: { display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', borderTop: '1px solid var(--border-light)', fontSize: 13 },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  statusHint: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', marginLeft: 'auto', maxWidth: '55%' },
  audioHint: { display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px 12px', color: 'var(--text-muted)', fontSize: 11 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', width: '100%', textAlign: 'left' },
  label: { fontSize: 14, color: 'var(--text-primary)', flex: 1 },
  value: { fontSize: 14, color: 'var(--text-secondary)', fontFamily: 'monospace', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' },
  divider: { height: 1, background: 'var(--border-light)', marginLeft: 40 },
  dangerRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', width: '100%', textAlign: 'left' },
  version: { textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 20 },
}
