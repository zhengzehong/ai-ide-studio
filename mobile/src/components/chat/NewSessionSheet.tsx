import { useEffect, useMemo, useState } from 'react'
import { Sparkles, ChevronDown, Check, Plus } from 'lucide-react'
import { useAppStore } from '../../stores/app.store'
import { useSessionStore } from '../../stores/session.store'
import { showToast } from '../../utils/toast'
import type { SessionTemplateData } from '@desktop/stores/session.store'
import { styles } from './NewSessionSheet.styles'
import { readLastAgent, writeLastAgent } from './NewSessionSheet.utils'
import TemplateList from './NewSessionSheetTemplateList'
import { useConversationCatalog } from '../../stores/conversation-catalog.store'
import { mergeMobileOwners } from '../../utils/team-conversations'
import { ConversationKindTag } from '../session-list/ConversationKindTag'
import { wsClient } from '@desktop/services/ws-client'

type CreateType = 'blank' | 'template'

interface Props {
  open: boolean
  projectId: string
  onClose: () => void
  onNewBlank: (agentId: string) => void
  onInstantiated: (sessionId: string) => void
}

export default function NewSessionSheet({
  open,
  projectId,
  onClose,
  onNewBlank,
  onInstantiated,
}: Props) {
  const projectAgents = useAppStore((s) => s.agents)
  const catalog = useConversationCatalog(s => s.catalog)
  const catalogLoaded = useConversationCatalog(s => s.loaded)
  const agents = useMemo(() => mergeMobileOwners(projectAgents, catalog, projectId), [projectAgents, catalog, projectId])
  const listSessionTemplates = useSessionStore((s) => s.listSessionTemplates)
  const instantiateSessionTemplate = useSessionStore((s) => s.instantiateSessionTemplate)

  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [createType, setCreateType] = useState<CreateType>('blank')
  const [templates, setTemplates] = useState<SessionTemplateData[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [instantiatingId, setInstantiatingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelectedAgentId(null)
    setCreateType('blank')
    setAgentDropdownOpen(false)
    setTemplates([])
    setTemplatesError(null)
    setInstantiatingId(null)
  }, [open, projectId])

  useEffect(() => {
    if (!open || !catalogLoaded) return
    setSelectedAgentId(current => {
      if (agents.some(agent => agent.id === current)) return current
      const last = readLastAgent(projectId)
      return agents.some(agent => agent.id === last) ? last : agents[0]?.id ?? null
    })
  }, [open, projectId, agents, catalogLoaded])

  useEffect(() => {
    if (!open || createType !== 'template' || !selectedAgentId) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setTemplatesLoading(true)
      setTemplatesError(null)
      void listSessionTemplates(selectedAgentId)
        .then((rows) => {
          if (!cancelled) setTemplates(rows)
        })
        .catch((err) => {
          if (!cancelled) setTemplatesError(err instanceof Error ? err.message : '加载模板失败')
        })
        .finally(() => {
          if (!cancelled) setTemplatesLoading(false)
        })
    })
    return () => {
      cancelled = true
    }
  }, [open, createType, selectedAgentId, listSessionTemplates])

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )

  if (!open) return null

  const handleConfirmBlank = async (): Promise<void> => {
    if (creating) return
    if (!selectedAgentId || !selectedAgent || !catalogLoaded) {
      showToast('请先选择 Agent 或团队')
      return
    }
    writeLastAgent(projectId, selectedAgentId)
    if (selectedAgent?.kind === 'team') {
      setCreating(true)
      try {
        const result = await wsClient.request({ type: 'team.conversation.create', teamId: selectedAgentId }) as { conversation: { master_session_id: string } }
        await useConversationCatalog.getState().load()
        if (!useConversationCatalog.getState().catalog.conversations.some(item => item.masterSessionId === result.conversation.master_session_id)) {
          showToast('会话已创建，列表刷新失败，请刷新列表后进入')
          onClose()
          return
        }
        onInstantiated(result.conversation.master_session_id)
        onClose()
      } catch (error) { showToast(error instanceof Error ? error.message : '创建团队会话失败') }
      finally { setCreating(false) }
      return
    }
    onNewBlank(selectedAgentId)
    onClose()
  }

  const handlePickTemplate = async (template: SessionTemplateData) => {
    if (!selectedAgentId) {
      showToast('请先选择 Agent')
      return
    }
    setInstantiatingId(template.id)
    setTemplatesError(null)
    try {
      writeLastAgent(projectId, selectedAgentId)
      const session = await instantiateSessionTemplate(template.id)
      onInstantiated(session.id)
      onClose()
    } catch (err) {
      setTemplatesError(err instanceof Error ? err.message : '从模板新建失败')
    } finally {
      setInstantiatingId(null)
    }
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={styles.sheetHeader}>
          <div style={styles.titleRow}>
            <Plus size={18} color="var(--primary)" />
            <span style={styles.sheetTitle}>新建会话</span>
          </div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div style={styles.body}>
          {/* Agent 选择 */}
          <div style={styles.fieldGroup}>
            <div style={styles.fieldLabel}>执行对象</div>
            <button
              style={styles.agentSelector}
              onClick={() => setAgentDropdownOpen((v) => !v)}
              aria-expanded={agentDropdownOpen}
              aria-label="选择 Agent 或团队"
            >
              <span style={styles.agentSelectorText}>
                {selectedAgent ? selectedAgent.name : (agents.length === 0 ? '暂无可用 Agent' : '请选择 Agent')}
              </span>
              <ChevronDown
                size={16}
                color="var(--text-muted)"
                style={{
                  transition: 'transform .15s',
                  transform: agentDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </button>
            {agentDropdownOpen && (
              <div style={styles.dropdown}>
                {agents.length === 0 && (
                  <div style={styles.dropdownEmpty}>暂无可用 Agent</div>
                )}
                {catalogLoaded && agents.map((agent) => (
                  <button
                    key={agent.id}
                    style={{
                      ...styles.dropdownItem,
                      ...(agent.id === selectedAgentId ? styles.dropdownItemActive : {}),
                    }}
                    onClick={() => {
                      setSelectedAgentId(agent.id)
                      setCreateType('blank')
                      setAgentDropdownOpen(false)
                    }}
                  >
                    <span style={styles.dropdownItemName}>{agent.name}<ConversationKindTag team={agent.kind === 'team'} /></span>
                    {agent.id === selectedAgentId && (
                      <Check size={16} color="var(--primary)" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 类型 radio */}
          <div style={styles.fieldGroup}>
            <div style={styles.fieldLabel}>类型</div>
            <div style={styles.radioRow}>
              <button
                style={{
                  ...styles.radio,
                  ...(createType === 'blank' ? styles.radioActive : {}),
                }}
                onClick={() => setCreateType('blank')}
                aria-pressed={createType === 'blank'}
              >
                <span style={styles.radioDot}>
                  {createType === 'blank' && <span style={styles.radioDotInner} />}
                </span>
                <Plus size={15} color={createType === 'blank' ? 'var(--primary)' : 'var(--text-muted)'} />
                <span>新建</span>
              </button>
              <button
                style={{
                  ...styles.radio,
                  ...(createType === 'template' ? styles.radioActive : {}),
                }}
                onClick={() => setCreateType('template')}
                disabled={selectedAgent?.kind === 'team'}
                aria-pressed={createType === 'template'}
              >
                <span style={styles.radioDot}>
                  {createType === 'template' && <span style={styles.radioDotInner} />}
                </span>
                <Sparkles size={15} color={createType === 'template' ? 'var(--primary)' : 'var(--text-muted)'} />
                <span>从模板</span>
              </button>
            </div>
          </div>

          {/* 模板列表(仅"从模板"展开) */}
          {createType === 'template' && (
            <div style={styles.templateSection}>
              <div style={styles.fieldLabel}>选择模板</div>
              <TemplateList
                templates={templates}
                loading={templatesLoading}
                error={templatesError}
                instantiatingId={instantiatingId}
                onPick={(t) => void handlePickTemplate(t)}
              />
            </div>
          )}
        </div>

        {/* 底部确认(仅新建类型显示;从模板直接点模板即确认) */}
        {createType === 'blank' && (
          <div style={styles.footer}>
            <button
              style={{
                ...styles.confirmBtn,
                opacity: selectedAgentId ? 1 : 0.4,
              }}
              onClick={handleConfirmBlank}
              disabled={!selectedAgent || !catalogLoaded || creating}
            >
              开始对话
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
