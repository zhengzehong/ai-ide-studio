import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAgentStore, type AgentData } from '../stores/agent.store';
import { useTaskStore, type SessionMode, type TaskData } from '../stores/task.store';
import { useProjectStore } from '../stores/project.store';
import { useSessionStore } from '../stores/session.store';
import { TaskImageInput } from '../components/task/TaskImageInput';
import { TaskDetailDrawer } from '../components/tasks/TaskDetailDrawer';
import type { ImageAttachmentInfo } from '../stores/session-events';

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

const SESSION_MODE_OPTIONS: Array<{ value: SessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
];

function sessionModeHelp(mode: SessionMode, hasSession: boolean): string {
  if (mode === 'existing') return hasSession ? '将在该会话中追加任务指派。' : '请选择一个已有会话。';
  if (mode === 'new_fixed') return '将创建一个新的固定会话用于这次任务。';
  return '将为这次任务创建新的会话。';
}

export default function TaskBoard() {
  const tasks = useTaskStore(s => s.tasks);
  const agents = useAgentStore(s => s.agents);
  const createTask = useTaskStore(s => s.createTask);
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
          onCreate={async (title, desc, agentId, sessionId, sessionMode, images) => {
            await createTask(title, desc, agentId, currentProjectId ?? undefined, sessionId, sessionMode, images);
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
          onDeleteComplete={() => setSelectedTaskId(null)}
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

function NewTaskModal({ agents, projectId, onCreate, onClose }: {
  agents: AgentData[];
  projectId: string | null;
  onCreate: (title: string, desc?: string, agentId?: string, sessionId?: string, sessionMode?: SessionMode, images?: ImageAttachmentInfo[]) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const [sessionMode, setSessionMode] = useState<SessionMode>('new_fixed');
  const [sessionId, setSessionId] = useState('');
  const [images, setImages] = useState<ImageAttachmentInfo[]>([]);
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
              onClick={() => { if (canCreate) onCreate(title, desc || undefined, agentId || undefined, sessionMode === 'existing' ? sessionId || undefined : undefined, agentId ? sessionMode : undefined, images); }}
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
