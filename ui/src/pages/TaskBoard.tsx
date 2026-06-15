import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Trash2, ExternalLink } from 'lucide-react';
import { useAgentStore, type AgentData } from '../stores/agent.store';
import { useTaskStore, type TaskData } from '../stores/task.store';
import { useProjectStore } from '../stores/project.store';
import { useSessionStore } from '../stores/session.store';

const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' };
const SOURCE_META: Record<string, { bg: string; color: string; label: string }> = {
  human: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '手动' },
  agent: { bg: 'var(--green-light)', color: 'var(--green)', label: 'Agent' },
  schedule: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '定时' },
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  backlog: { label: '待办', color: 'var(--text-3)', bg: 'var(--bg-2)' },
  executing: { label: '执行中', color: 'var(--blue)', bg: 'var(--blue-light)' },
  needs_input: { label: '待确认', color: '#d97706', bg: '#fef3c7' },
  blocked: { label: '已阻塞', color: 'var(--red)', bg: '#fee2e2' },
  reviewing: { label: '审查中', color: '#2563eb', bg: '#dbeafe' },
  completed: { label: '已完成', color: 'var(--green)', bg: 'var(--green-light)' },
  cancelled: { label: '已取消', color: 'var(--text-3)', bg: 'var(--bg-2)' },
};

interface Column { id: string; title: string; color: string; match: (s: string) => boolean }
const COLUMNS: Column[] = [
  { id: 'backlog', title: '待办', color: 'var(--text-3)', match: s => s === 'backlog' },
  { id: 'active', title: '进行中', color: 'var(--blue)', match: s => s === 'executing' || s === 'needs_input' },
  { id: 'needs_attention', title: '需处理', color: 'var(--red)', match: s => s === 'blocked' || s === 'reviewing' },
  { id: 'done', title: '已完成', color: 'var(--green)', match: s => s === 'completed' || s === 'cancelled' },
];

const STATUS_ACTIONS = [
  { status: 'backlog', label: '待办' },
  { status: 'executing', label: '执行中' },
  { status: 'reviewing', label: '审查中' },
  { status: 'completed', label: '已完成' },
  { status: 'blocked', label: '已阻塞' },
  { status: 'cancelled', label: '已取消' },
];

export default function TaskBoard() {
  const tasks = useTaskStore(s => s.tasks);
  const agents = useAgentStore(s => s.agents);
  const createTask = useTaskStore(s => s.createTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const fetchTasks = useTaskStore(s => s.fetchTasks);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [showNew, setShowNew] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks(currentProjectId ?? undefined);
  }, [currentProjectId, fetchTasks]);

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
        <button onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 15, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
          <Plus size={14} /> 新建任务
        </button>
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
          onCreate={async (title, desc, agentId, sessionId) => {
            await createTask(title, desc, agentId, currentProjectId ?? undefined, sessionId);
            setShowNew(false);
          }}
          onClose={() => setShowNew(false)}
        />
      )}
      {selectedTaskId && (
        <TaskDetailDrawer
          task={projectTasks.find(t => t.id === selectedTaskId)}
          agents={agents}
          onClose={() => setSelectedTaskId(null)}
          onStatusChange={(status) => updateTask(selectedTaskId, status)}
          onDelete={async () => { await deleteTask(selectedTaskId); setSelectedTaskId(null); }}
        />
      )}
    </div>
  );
}

function getCardBorder(status: string): string {
  switch (status) {
    case 'needs_input': return '2px solid #d97706';
    case 'blocked': return '2px solid var(--red)';
    case 'reviewing': return '2px solid #2563eb';
    default: return '1px solid var(--border)';
  }
}

function TaskCard({ task, agents, onOpen }: { task: TaskData; agents: AgentData[]; onOpen: () => void }) {
  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.backlog;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;

  return (
    <button type="button" onClick={onOpen} style={{ background: 'var(--bg-0)', border: getCardBorder(task.status), borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'box-shadow 0.15s', textAlign: 'left', color: 'var(--text-1)' }}>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5, marginBottom: 8 }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ padding: '2px 7px', borderRadius: 4, background: source.bg, color: source.color, fontWeight: 600, fontSize: 12 }}>{source.label}</span>
        <span style={{ padding: '2px 7px', borderRadius: 4, background: statusMeta.bg, color: statusMeta.color, fontWeight: 600, fontSize: 12 }}>{statusMeta.label}</span>
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

function TaskDetailDrawer({ task, agents, onClose, onStatusChange, onDelete }: {
  task: TaskData | undefined;
  agents: AgentData[];
  onClose: () => void;
  onStatusChange: (status: string) => Promise<TaskData>;
  onDelete: () => Promise<void>;
}) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editing, setEditing] = useState(false);
  const [assignAgentId, setAssignAgentId] = useState('');
  const [assignSessionId, setAssignSessionId] = useState('');
  const updateTaskInfo = useTaskStore(s => s.updateTaskInfo);
  const assignTask = useTaskStore(s => s.assignTask);
  const selectSession = useSessionStore(s => s.selectSession);
  const sessions = useSessionStore(s => s.sessions);

  if (!task) return null;

  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const statusMeta = STATUS_META[task.status] ?? STATUS_META.backlog;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;
  const assignAgentSessions = assignAgentId
    ? sessions.filter(s => s.agent_id === assignAgentId && (!task.project_id || s.project_id === task.project_id))
    : [];

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

  const changeStatus = async (status: string) => {
    setUpdating(status);
    try { await onStatusChange(status); } finally { setUpdating(null); }
  };

  const handleAssign = async () => {
    if (!assignAgentId) return;
    await assignTask(task.id, assignAgentId, assignSessionId || undefined);
    setAssignAgentId('');
    setAssignSessionId('');
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

  const st: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.24)', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 92vw)', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>任务详情</h2>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={15} /></button>
        </div>

        {editing ? (
          <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={editTitle} onChange={e => setEditTitle(e.target.value)} style={st} placeholder="任务标题" />
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} style={{ ...st, resize: 'vertical' }} placeholder="描述" />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={saveEdit} disabled={!editTitle.trim()} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 14, cursor: 'pointer' }}>保存</button>
              <button onClick={() => setEditing(false)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }}>取消</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.45, flex: 1 }}>{task.title}</div>
              <button type="button" onClick={startEdit} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, padding: '4px 8px', fontSize: 13, color: 'var(--text-2)', cursor: 'pointer' }}>编辑</button>
            </div>
            <div style={{ color: 'var(--text-2)', fontSize: 15, lineHeight: 1.7, marginBottom: 18, whiteSpace: 'pre-wrap' }}>{task.description || '暂无描述'}</div>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', marginBottom: 18 }}>
          <DetailRow label="状态" value={statusMeta.label} color={statusMeta.color} />
          <DetailRow label="阶段" value={task.stage || '未设置'} />
          <DetailRow label="指派 Agent" value={agent ? `${agent.name} (${agent.runtime})` : '未指派'} />
          <DetailRow label="来源" value={source.label} color={source.color} />
          <DetailRow label="创建时间" value={formatDateTime(task.created_at)} />
          {task.completed_at && <DetailRow label="完成时间" value={formatDateTime(task.completed_at)} />}
          {task.sessionId && (
            <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 14 }}>
              <span style={{ color: 'var(--text-3)' }}>关联对话</span>
              <button type="button" onClick={() => goToSession(task.sessionId!)} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--blue)', cursor: 'pointer', border: 'none', background: 'none', padding: 0, fontSize: 14 }}>
                <ExternalLink size={11} />跳转到对话
              </button>
            </div>
          )}
        </div>

        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>指派 Agent</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select value={assignAgentId} onChange={e => { setAssignAgentId(e.target.value); setAssignSessionId(''); }} style={{ ...st, flex: 1 }}>
            <option value="">{agent ? `当前: ${agent.name}` : '选择 Agent'}</option>
            {agents.filter(a => a.id !== task.assigned_agent_id).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button onClick={handleAssign} disabled={!assignAgentId} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: assignAgentId ? 'var(--blue)' : 'var(--bg-2)', color: assignAgentId ? 'white' : 'var(--text-3)', fontSize: 14, cursor: assignAgentId ? 'pointer' : 'not-allowed' }}>指派</button>
        </div>
        {assignAgentId && (
          <div style={{ marginBottom: 18 }}>
            <select value={assignSessionId} onChange={e => setAssignSessionId(e.target.value)} style={st}>
              <option value="">新建会话（默认）</option>
              {assignAgentSessions.map(s => <option key={s.id} value={s.id}>{sessionOptionLabel(s)}</option>)}
            </select>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              {assignSessionId ? '将在该会话中追加任务指派。' : '将为此任务创建新的会话。'}
            </div>
          </div>
        )}

        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>状态操作</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {STATUS_ACTIONS.map(action => (
            <button key={action.status} type="button" onClick={() => changeStatus(action.status)} disabled={updating !== null || task.status === action.status} style={{ padding: '7px 12px', borderRadius: 8, border: task.status === action.status ? '1px solid var(--blue)' : '1px solid var(--border)', background: task.status === action.status ? 'var(--blue-light)' : 'var(--bg-0)', color: task.status === action.status ? 'var(--blue)' : 'var(--text-2)', fontSize: 14, cursor: task.status === action.status ? 'default' : 'pointer', opacity: updating && updating !== action.status ? 0.6 : 1 }}>
              {updating === action.status ? '...' : action.label}
            </button>
          ))}
        </div>

        <button type="button" onClick={handleDelete} disabled={deleting} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 14, cursor: 'pointer' }}>
          <Trash2 size={13} /> {deleting ? '删除中...' : '删除任务'}
        </button>
      </aside>
    </>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 14 }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ color: color || 'var(--text-1)', overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function NewTaskModal({ agents, projectId, onCreate, onClose }: {
  agents: AgentData[];
  projectId: string | null;
  onCreate: (title: string, desc?: string, agentId?: string, sessionId?: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const sessions = useSessionStore(s => s.sessions);

  const agentSessions = useMemo(() => {
    if (!agentId) return [];
    return sessions.filter(s => s.agent_id === agentId);
  }, [agentId, sessions]);

  const st: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 460, background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建任务</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="任务标题（必填）" style={st} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="描述（可选）" rows={3} style={{ ...st, resize: 'vertical' }} />
          <select value={agentId} onChange={e => { setAgentId(e.target.value); setSessionId(''); }} style={st}>
            <option value="">不指派 Agent</option>
            {agents.filter(a => !projectId || a.project_id === projectId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {agentId && (
            <>
              <select value={sessionId} onChange={e => setSessionId(e.target.value)} style={st}>
                <option value="">新建会话（默认）</option>
                {agentSessions.map(s => <option key={s.id} value={s.id}>{s.id.slice(0, 8)}... {s.task_id ? '(有任务)' : ''}</option>)}
              </select>
              <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: -6 }}>
                {sessionId ? '将在该对话中追加任务指派，Agent 可利用已有上下文' : '将为此任务创建新的对话'}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => { if (title.trim()) onCreate(title, desc || undefined, agentId || undefined, sessionId || undefined); }}
              disabled={!title.trim()}
              style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none', background: title.trim() ? 'var(--blue)' : 'var(--bg-2)', color: title.trim() ? 'white' : 'var(--text-3)', fontSize: 15, fontWeight: 500, cursor: title.trim() ? 'pointer' : 'not-allowed' }}
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
