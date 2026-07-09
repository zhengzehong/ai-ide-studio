import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Trash2, ExternalLink, Send } from 'lucide-react';
import { useAgentStore, type AgentData } from '../stores/agent.store';
import { useTaskStore, type SessionMode, type TaskData, type TaskEventData } from '../stores/task.store';
import { useProjectStore } from '../stores/project.store';
import { useSessionStore } from '../stores/session.store';
import { TaskImageInput } from '../components/task/TaskImageInput';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import type { ImageAttachmentInfo } from '../stores/session-events';

const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' };
const SOURCE_META: Record<string, { bg: string; color: string; label: string }> = {
  human: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '手动' },
  agent: { bg: 'var(--green-light)', color: 'var(--green)', label: 'Agent' },
  schedule: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '定时' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: '待办', color: 'var(--text-3)', bg: 'var(--bg-2)' },
  running: { label: '行动中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  needs_input: { label: '需确认', color: '#d97706', bg: '#fef3c7' },
  completed: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
  cancelled: { label: '已取消', color: 'var(--text-3)', bg: 'var(--bg-2)' },
};

const AGENT_REPORT_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: '进行中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  milestone: { label: '里程碑', color: '#7c3aed', bg: '#ede9fe' },
  blocked: { label: '卡住', color: 'var(--red)', bg: '#fee2e2' },
  done: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
};

interface Column { id: string; title: string; color: string; match: (s: string) => boolean }
const COLUMNS: Column[] = [
  { id: 'draft', title: '待办', color: 'var(--text-3)', match: s => s === 'draft' },
  { id: 'running', title: '进行中', color: 'var(--blue)', match: s => s === 'running' },
  { id: 'needs_input', title: '需确认', color: '#d97706', match: s => s === 'needs_input' },
  { id: 'done', title: '已完成', color: 'var(--green)', match: s => s === 'completed' || s === 'cancelled' },
];

const STATUS_OPTIONS = [
  { status: 'draft', label: '待办' },
  { status: 'running', label: '行动中' },
  { status: 'needs_input', label: '需确认' },
  { status: 'completed', label: '已完成' },
  { status: 'cancelled', label: '已取消' },
];

const SESSION_MODE_OPTIONS: Array<{ value: SessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
];

const EVENT_TYPE_META: Record<string, { label: string; color: string }> = {
  created: { label: '创建', color: 'var(--text-3)' },
  assigned_agent: { label: '分派', color: '#7c3aed' },
  assigned: { label: '分派', color: '#7c3aed' },
  progress: { label: '进度', color: 'var(--text-3)' },
  milestone: { label: '里程碑', color: '#7c3aed' },
  input_requested: { label: '请求确认', color: '#d97706' },
  marked_done: { label: '标记完成', color: 'var(--green)' },
  replied: { label: '人工回复', color: 'var(--blue)' },
  status_changed: { label: '状态变更', color: 'var(--text-3)' },
  manual_status_change: { label: '手动改状态', color: 'var(--text-3)' },
  agent_status_changed: { label: 'Agent状态', color: 'var(--text-3)' },
  updated: { label: '更新', color: 'var(--text-3)' },
  deleted: { label: '删除', color: 'var(--red)' },
  session_linked: { label: '关联会话', color: 'var(--text-3)' },
};

function sessionModeHelp(mode: SessionMode, hasSession: boolean): string {
  if (mode === 'existing') return hasSession ? '将在该会话中追加任务指派。' : '请选择一个已有会话。';
  if (mode === 'new_fixed') return '将创建一个新的固定会话用于这次任务。';
  return '将为这次任务创建新的会话。';
}

export default function TaskBoard() {
  const tasks = useTaskStore(s => s.tasks);
  const modes = useTaskStore(s => s.modes);
  const agents = useAgentStore(s => s.agents);
  const createTask = useTaskStore(s => s.createTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const fetchTasks = useTaskStore(s => s.fetchTasks);
  const fetchModes = useTaskStore(s => s.fetchModes);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [showNew, setShowNew] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks(currentProjectId ?? undefined);
    fetchModes(currentProjectId ?? undefined);
  }, [currentProjectId, fetchTasks, fetchModes]);

  const projectTasks = useMemo(() => {
    if (!currentProjectId) return tasks;
    return tasks.filter(t => t.project_id === currentProjectId);
  }, [tasks, currentProjectId]);

  const grouped = useMemo(() => {
    const m = new Map<string, TaskData[]>();
    for (const col of COLUMNS) m.set(col.id, projectTasks.filter(t => col.match(t.status)));
    return m;
  }, [projectTasks]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>任务看板</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.location.hash = '#/tasks/modes'} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }}>
            执行模式
          </button>
          <button onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 15, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
            <Plus size={14} /> 新建任务
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', flex: 1, minHeight: 0 }}>
        {COLUMNS.map(col => {
          const items = grouped.get(col.id) ?? [];
          return (
            <div key={col.id} style={{ minWidth: 280, flex: '1 0 280px', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-2)' }}>
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{col.title}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-3)' }}>{items.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.length === 0
                  ? <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 14, padding: '32px 16px' }}>暂无任务</div>
                  : items.map(t => <TaskCard key={t.id} task={t} agents={agents} onOpen={() => setSelectedTaskId(t.id)} />)
                }
              </div>
            </div>
          );
        })}
      </div>
      {showNew && (
        <NewTaskModal
          agents={agents}
          projectId={currentProjectId}
          modes={modes}
          onCreate={async (title, desc, agentId, sessionId, sessionMode, images, executionModeId) => {
            await createTask(title, desc, agentId, currentProjectId ?? undefined, sessionId, sessionMode, images, executionModeId);
            setShowNew(false);
          }}
          onClose={() => setShowNew(false)}
        />
      )}
      {selectedTaskId && (
        <TaskDetailDrawer
          task={projectTasks.find(t => t.id === selectedTaskId)}
          agents={agents}
          modes={modes}
          onClose={() => setSelectedTaskId(null)}
          onStatusChange={(status, reason) => updateTask(selectedTaskId, status, undefined, reason)}
          onDelete={async () => { await deleteTask(selectedTaskId); setSelectedTaskId(null); }}
        />
      )}
    </div>
  );
}

function getCardBorder(status: string): string {
  if (status === 'needs_input') return '2px solid #d97706';
  return '1px solid var(--border)';
}

function TaskCard({ task, agents, onOpen }: { task: TaskData; agents: AgentData[]; onOpen: () => void }) {
  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.draft;
  const agentReportMeta = task.agent_report_status ? AGENT_REPORT_STATUS_META[task.agent_report_status] : null;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;

  return (
    <button type="button" onClick={onOpen} style={{ background: 'var(--bg-0)', border: getCardBorder(task.status), borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'box-shadow 0.15s', textAlign: 'left', color: 'var(--text-1)' }}>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, marginBottom: 8 }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ padding: '2px 7px', borderRadius: 4, background: source.bg, color: source.color, fontWeight: 600, fontSize: 12 }}>{source.label}</span>
        <span style={{ padding: '2px 7px', borderRadius: 4, background: statusMeta.bg, color: statusMeta.color, fontWeight: 600, fontSize: 12 }}>{statusMeta.label}</span>
        {agentReportMeta && (
          <span style={{ padding: '2px 7px', borderRadius: 4, background: agentReportMeta.bg, color: agentReportMeta.color, fontWeight: 500, fontSize: 11 }}>Agent: {agentReportMeta.label}</span>
        )}
      </div>
      {task.stage && <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.stage}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {agent ? (
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: TYPE_COLORS[agent.type] ?? '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' }} title={agent.name}>{agent.name.charAt(0)}</div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>未指派</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatRelative(task.created_at)}</span>
      </div>
    </button>
  );
}

function parseEventPayload(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

function TaskDetailDrawer({ task, agents, modes, onClose, onStatusChange, onDelete }: {
  task: TaskData | undefined;
  agents: AgentData[];
  modes: Array<{ id: string; name: string }>;
  onClose: () => void;
  onStatusChange: (status: string, reason?: string) => Promise<TaskData>;
  onDelete: () => Promise<void>;
}) {
  const [updating, setUpdating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editing, setEditing] = useState(false);
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assignSessionMode, setAssignSessionMode] = useState<SessionMode>('new_fixed');
  const [assignSessionId, setAssignSessionId] = useState('');
  const [events, setEvents] = useState<TaskEventData[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [statusModalValue, setStatusModalValue] = useState('');
  const [statusModalReason, setStatusModalReason] = useState('');
  const updateTaskInfo = useTaskStore(s => s.updateTaskInfo);
  const assignTask = useTaskStore(s => s.assignTask);
  const replyTask = useTaskStore(s => s.replyTask);
  const fetchTaskEvents = useTaskStore(s => s.fetchTaskEvents);
  const selectSession = useSessionStore(s => s.selectSession);
  const sessions = useSessionStore(s => s.sessions);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    fetchTaskEvents(task.id).then(loaded => {
      if (cancelled) return;
      setEvents(loaded);
      const latestWithMd = loaded.find(ev => {
        const payload = parseEventPayload(ev.payload_json);
        return typeof payload.report_md === 'string' && payload.report_md;
      }) ?? loaded[0] ?? null;
      setSelectedEventId(latestWithMd?.id ?? null);
    });
    return () => { cancelled = true; };
  }, [task?.id, fetchTaskEvents]);

  if (!task) return null;

  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.draft;
  const agentReportMeta = task.agent_report_status ? AGENT_REPORT_STATUS_META[task.agent_report_status] : null;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;
  const currentMode = task.execution_mode_id ? modes.find(m => m.id === task.execution_mode_id) : null;
  const assignAgentSessions = assignAgentId
    ? sessions.filter(s => s.agent_id === assignAgentId && (!task.project_id || s.project_id === task.project_id))
    : [];

  const iterationCount = events.filter(ev => ev.type === 'input_requested' || ev.type === 'marked_done').length;
  const sortedEvents = [...events].sort((a, b) => b.sequence - a.sequence);
  const selectedEvent = selectedEventId ? sortedEvents.find(ev => ev.id === selectedEventId) ?? null : sortedEvents[0] ?? null;
  const selectedPayload = selectedEvent ? parseEventPayload(selectedEvent.payload_json) : {};
  const selectedReportMd = typeof selectedPayload.report_md === 'string' ? selectedPayload.report_md
    : typeof selectedPayload.message === 'string' ? selectedPayload.message
    : typeof selectedPayload.reason === 'string' ? selectedPayload.reason
    : '';
  const isSelectedLatest = selectedEvent ? sortedEvents[0]?.id === selectedEvent.id : false;

  const startEdit = () => {
    setEditTitle(task.title);
    setEditDesc(task.description || '');
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) return;
    await updateTaskInfo(task.id, { title: editTitle.trim(), description: editDesc.trim() || undefined });
    setEditing(false);
  };

  const handleAssign = async () => {
    if (!assignAgentId) return;
    if (assignSessionMode === 'existing' && !assignSessionId) return;
    await assignTask(task.id, assignAgentId, assignSessionMode === 'existing' ? assignSessionId || undefined : undefined, assignSessionMode);
    setAssignAgentId('');
    setAssignSessionMode('new_fixed');
    setAssignSessionId('');
  };

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setUpdating(true);
    try {
      await replyTask(task.id, replyText.trim());
      setReplyText('');
      setReplyOpen(false);
      const refreshed = await fetchTaskEvents(task.id);
      setEvents(refreshed);
      const latest = refreshed[0];
      if (latest) setSelectedEventId(latest.id);
    } finally { setUpdating(false); }
  };

  const openStatusModal = () => {
    setStatusModalValue(task.status);
    setStatusModalReason('');
    setStatusModalOpen(true);
  };

  const confirmStatusChange = async () => {
    setUpdating(true);
    try {
      await onStatusChange(statusModalValue, statusModalReason.trim() || undefined);
      setStatusModalOpen(false);
      const refreshed = await fetchTaskEvents(task.id);
      setEvents(refreshed);
    } finally { setUpdating(false); }
  };

  const handleDelete = async () => {
    if (!confirm('确定删除此任务？')) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  };

  const goToSession = (sessionId: string) => {
    selectSession(sessionId);
    onClose();
    window.location.hash = '#/workspace';
  };

  const st: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' };

  const eventTitle = (ev: TaskEventData): string => {
    const p = parseEventPayload(ev.payload_json);
    if (ev.type === 'replied') return '人工回复';
    if (ev.type === 'input_requested') return '请求确认';
    if (ev.type === 'marked_done') return '标记完成';
    if (ev.type === 'milestone') return '里程碑汇报';
    if (ev.type === 'progress') return '更新进度';
    if (ev.type === 'status_changed' || ev.type === 'manual_status_change') {
      const from = typeof p.from_status === 'string' ? p.from_status : '?';
      const to = typeof p.to_status === 'string' ? p.to_status : '?';
      return `状态变更: ${from} → ${to}`;
    }
    if (ev.type === 'assigned' || ev.type === 'assigned_agent') return '分派 Agent';
    if (ev.type === 'created') return '创建任务';
    if (ev.type === 'session_linked') return '关联会话';
    return ev.type;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.24)', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(960px, 96vw)', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{editing ? '编辑任务' : task.title}</h2>
          {!editing && (
            <button type="button" onClick={startEdit} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, padding: '4px 10px', fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>编辑</button>
          )}
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={15} /></button>
        </div>

        {editing ? (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={st} placeholder="任务标题" />
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={4} style={{ ...st, resize: 'vertical' }} placeholder="描述" />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveEdit} disabled={!editTitle.trim()} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 14, cursor: 'pointer' }}>保存</button>
              <button onClick={() => setEditing(false)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            {/* 左栏: 历史时间线 */}
            <div style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '12px 0' }}>
              <div style={{ padding: '0 14px 8px', fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>历史时间线 ({events.length})</div>
              {sortedEvents.length === 0 && <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-3)' }}>暂无记录</div>}
              {sortedEvents.map(ev => {
                const meta = EVENT_TYPE_META[ev.type] ?? { label: ev.type, color: 'var(--text-3)' };
                const isSelected = selectedEvent?.id === ev.id;
                return (
                  <button key={ev.id} type="button" onClick={() => setSelectedEventId(ev.id)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border-light)', background: isSelected ? 'var(--bg-2)' : 'transparent', cursor: 'pointer', color: 'var(--text-1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{eventTitle(ev)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{formatRelative(ev.created_at)}</div>
                  </button>
                );
              })}
            </div>

            {/* 中栏: MD 报告内容 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, minWidth: 0 }}>
              {selectedEvent ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--text-2)', fontSize: 12, fontWeight: 600 }}>
                      {(EVENT_TYPE_META[selectedEvent.type] ?? { label: selectedEvent.type }).label}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatDateTime(selectedEvent.created_at)}</span>
                    {isSelectedLatest && selectedReportMd && (
                      <button type="button" onClick={() => {
                        const edited = prompt('编辑报告内容:', selectedReportMd);
                        if (edited != null) {
                          updateTaskInfo(task.id, { description: edited });
                        }
                      }} style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'var(--bg-1)', borderRadius: 6, padding: '3px 8px', fontSize: 12, color: 'var(--text-2)', cursor: 'pointer' }}>编辑报告</button>
                    )}
                  </div>
                  {selectedReportMd ? (
                    <MarkdownRenderer content={selectedReportMd} />
                  ) : (
                    <div style={{ color: 'var(--text-3)', fontSize: 14, fontStyle: 'italic' }}>该记录无可显示内容。</div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-3)', fontSize: 14 }}>选择左侧时间线查看详情。</div>
              )}
            </div>

            {/* 右栏: 操作面板 */}
            <div style={{ width: 220, flexShrink: 0, borderLeft: '1px solid var(--border)', overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {task.status === 'draft' && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>指派 Agent 后任务开始执行</div>
                )}
                {task.status === 'needs_input' && (
                  <button type="button" onClick={() => setReplyOpen(o => !o)} disabled={updating} style={{ padding: '8px 12px', borderRadius: 6, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>回复 AI</button>
                )}
                <button type="button" onClick={openStatusModal} disabled={updating} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-1)', fontSize: 14, cursor: 'pointer' }}>改状态</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
                <DetailRow label="任务状态" value={statusMeta.label} color={statusMeta.color} />
                {agentReportMeta && <DetailRow label="Agent自评" value={agentReportMeta.label} color={agentReportMeta.color} />}
                <DetailRow label="迭代轮次" value={`${iterationCount}`} />
                {task.stage && <DetailRow label="阶段" value={task.stage} />}
                <DetailRow label="指派 Agent" value={agent ? agent.name : '未指派'} />
                <DetailRow label="来源" value={source.label} color={source.color} />
                {currentMode && <DetailRow label="执行模式" value={currentMode.name} color="#7c3aed" />}
                <DetailRow label="创建时间" value={formatDateTime(task.created_at)} />
                {task.completed_at && <DetailRow label="完成时间" value={formatDateTime(task.completed_at)} />}
                {task.sessionId && (
                  <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, fontSize: 13 }}>
                    <span style={{ color: 'var(--text-3)' }}>关联对话</span>
                    <button type="button" onClick={() => goToSession(task.sessionId!)} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--blue)', cursor: 'pointer', border: 'none', background: 'none', padding: 0, fontSize: 13 }}>
                      <ExternalLink size={11} />跳转
                    </button>
                  </div>
                )}
              </div>

              {task.status === 'draft' && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>指派 Agent</div>
                  <select value={assignAgentId} onChange={e => { setAssignAgentId(e.target.value); setAssignSessionMode('new_fixed'); setAssignSessionId(''); }} style={st}>
                    <option value="">{agent ? `当前: ${agent.name}` : '选择 Agent'}</option>
                    {agents.filter(a => a.id !== task.assigned_agent_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  {assignAgentId && (
                    <div style={{ marginTop: 8 }}>
                      <SessionModeSelect
                        mode={assignSessionMode}
                        sessionId={assignSessionId}
                        sessions={assignAgentSessions}
                        onModeChange={(value) => { setAssignSessionMode(value); setAssignSessionId(''); }}
                        onSessionChange={setAssignSessionId}
                        inputStyle={st}
                      />
                      <button onClick={handleAssign} disabled={assignSessionMode === 'existing' && !assignSessionId} style={{ marginTop: 8, width: '100%', padding: '6px', borderRadius: 6, border: 'none', background: assignSessionMode === 'existing' && !assignSessionId ? 'var(--bg-2)' : 'var(--blue)', color: assignSessionMode === 'existing' && !assignSessionId ? 'var(--text-3)' : 'white', fontSize: 13, cursor: assignSessionMode === 'existing' && !assignSessionId ? 'not-allowed' : 'pointer' }}>确认指派</button>
                    </div>
                  )}
                </div>
              )}

              <button type="button" onClick={handleDelete} disabled={deleting} style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px', borderRadius: 6, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 13, cursor: 'pointer' }}>
                <Trash2 size={12} /> {deleting ? '删除中...' : '删除任务'}
              </button>
            </div>
          </div>
        )}

        {/* 回复 AI 输入框 */}
        {replyOpen && task.status === 'needs_input' && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-1)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="输入回复内容，AI 会收到并继续执行..." rows={2} style={{ ...st, flex: 1, resize: 'none' }} />
            <button type="button" onClick={handleReply} disabled={updating || !replyText.trim()} style={{ padding: '0 16px', borderRadius: 6, border: 'none', background: updating || !replyText.trim() ? 'var(--bg-2)' : 'var(--blue)', color: updating || !replyText.trim() ? 'var(--text-3)' : 'white', fontSize: 14, cursor: updating || !replyText.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Send size={13} /> 发送
            </button>
          </div>
        )}

        {/* 改状态弹窗 */}
        {statusModalOpen && (
          <>
            <div onClick={() => setStatusModalOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1100 }} />
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 360, background: 'var(--bg-0)', borderRadius: 10, border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1101, padding: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>修改任务状态</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <select value={statusModalValue} onChange={e => setStatusModalValue(e.target.value)} style={st}>
                  {STATUS_OPTIONS.map(opt => <option key={opt.status} value={opt.status}>{opt.label}</option>)}
                </select>
                <textarea value={statusModalReason} onChange={e => setStatusModalReason(e.target.value)} placeholder="原因（可选）" rows={2} style={{ ...st, resize: 'none' }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setStatusModalOpen(false)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>取消</button>
                  <button onClick={confirmStatusChange} disabled={updating || statusModalValue === task.status} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: updating || statusModalValue === task.status ? 'var(--bg-2)' : 'var(--blue)', color: updating || statusModalValue === task.status ? 'var(--text-3)' : 'white', fontSize: 13, cursor: updating || statusModalValue === task.status ? 'not-allowed' : 'pointer' }}>确认</button>
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 6, fontSize: 13 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-1)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function NewTaskModal({ agents, projectId, modes, onCreate, onClose }: {
  agents: AgentData[];
  projectId: string | null;
  modes: Array<{ id: string; name: string }>;
  onCreate: (title: string, desc?: string, agentId?: string, sessionId?: string, sessionMode?: SessionMode, images?: ImageAttachmentInfo[], executionModeId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const [sessionMode, setSessionMode] = useState<SessionMode>('new_fixed');
  const [sessionId, setSessionId] = useState('');
  const [images, setImages] = useState<ImageAttachmentInfo[]>([]);
  const [executionModeId, setExecutionModeId] = useState('');
  const sessions = useSessionStore(s => s.sessions);

  const agentSessions = useMemo(() => {
    if (!agentId) return [];
    return sessions.filter(s => s.agent_id === agentId);
  }, [agentId, sessions]);

  const st: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' };
  const canCreate = title.trim() && (!agentId || sessionMode !== 'existing' || sessionId);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 460, background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建任务</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="任务标题（必填）" style={st} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="描述（可选）" rows={3} style={{ ...st, resize: 'vertical' }} />
          <TaskImageInput images={images} onChange={setImages} />
          {modes.length > 0 && (
            <select value={executionModeId} onChange={e => setExecutionModeId(e.target.value)} style={st}>
              <option value="">默认执行</option>
              {modes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <select value={agentId} onChange={e => { setAgentId(e.target.value); setSessionMode('new_fixed'); setSessionId(''); }} style={st}>
            <option value="">不指派 Agent</option>
            {agents.filter(a => !projectId || a.project_id === projectId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {agentId && (
            <SessionModeSelect
              mode={sessionMode}
              sessionId={sessionId}
              sessions={agentSessions}
              onModeChange={(value) => { setSessionMode(value); setSessionId(''); }}
              onSessionChange={setSessionId}
              inputStyle={st}
            />
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => { if (canCreate) onCreate(title, desc || undefined, agentId || undefined, sessionMode === 'existing' ? sessionId || undefined : undefined, agentId ? sessionMode : undefined, images, executionModeId || undefined); }}
              disabled={!canCreate}
              style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none', background: canCreate ? 'var(--blue)' : 'var(--bg-2)', color: canCreate ? 'white' : 'var(--text-3)', fontSize: 15, fontWeight: 500, cursor: canCreate ? 'pointer' : 'not-allowed' }}
            >创建</button>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 15, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      </div>
    </>
  );
}

function formatDateTime(iso: string): string {
  try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; }
}

function SessionModeSelect({ mode, sessionId, sessions, onModeChange, onSessionChange, inputStyle }: {
  mode: SessionMode;
  sessionId: string;
  sessions: Array<{ id: string; title?: string | null; task_id?: string | null }>;
  onModeChange: (value: SessionMode) => void;
  onSessionChange: (value: string) => void;
  inputStyle: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <select value={mode} onChange={e => onModeChange(e.target.value as SessionMode)} style={inputStyle}>
        {SESSION_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {mode === 'existing' && (
        <select value={sessionId} onChange={e => onSessionChange(e.target.value)} style={inputStyle}>
          <option value="">请选择已有会话</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{sessionOptionLabel(s)}</option>)}
        </select>
      )}
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
        {sessionModeHelp(mode, Boolean(sessionId))}
      </div>
    </div>
  );
}

function sessionOptionLabel(session: { id: string; title?: string | null; task_id?: string | null }): string {
  const title = session.title?.trim();
  return title ? title : `${session.id.slice(0, 8)}...${session.task_id ? '（有任务）' : ''}`;
}

function formatRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  } catch { return iso; }
}
