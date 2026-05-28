import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAgentStore, type AgentData } from '../stores/agent.store';
import { useTaskStore, type TaskData } from '../stores/task.store';
import { useProjectStore } from '../stores/project.store';

const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' };
const SOURCE_META: Record<string, { bg: string; color: string; label: string }> = {
  human: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '手动' },
  agent: { bg: 'var(--green-light)', color: 'var(--green)', label: 'Agent' },
  event: { bg: 'var(--yellow-light)', color: 'var(--yellow)', label: '事件' },
  schedule: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '定时' },
};

interface Column { id: string; title: string; color: string; match: (s: string) => boolean }
const COLUMNS: Column[] = [
  { id: 'blocked', title: '等待决策', color: 'var(--red)', match: s => s === 'blocked' },
  { id: 'active', title: '进行中', color: 'var(--blue)', match: s => s === 'executing' || s === 'planning' || s === 'reviewing' },
  { id: 'done', title: '已完成', color: 'var(--green)', match: s => s === 'completed' },
  { id: 'backlog', title: '待办', color: 'var(--text-3)', match: s => s === 'backlog' },
];
const STATUS_ACTIONS = [
  { status: 'executing', label: '执行中' },
  { status: 'reviewing', label: '审查中' },
  { status: 'completed', label: '已完成' },
  { status: 'blocked', label: '已阻塞' },
];

export default function TaskBoard() {
  const tasks = useTaskStore(s => s.tasks);
  const agents = useAgentStore(s => s.agents);
  const createTask = useTaskStore(s => s.createTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [showNew, setShowNew] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, TaskData[]>();
    for (const col of COLUMNS) m.set(col.id, tasks.filter(t => col.match(t.status)));
    return m;
  }, [tasks]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>任务看板</h1>
        <button onClick={() => setShowNew(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
          <Plus size={14} /> 新建任务
        </button>
      </div>
      <div style={{ display: 'flex', gap: 16, overflowX: 'auto', flex: 1, minHeight: 0 }}>
        {COLUMNS.map(col => {
          const items = grouped.get(col.id) ?? [];
          return (
            <div key={col.id} style={{ minWidth: 300, flex: '1 0 300px', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--bg-2)' }}>
              <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{col.title}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>{items.length}</span>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.length === 0
                  ? <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: '32px 16px' }}>暂无任务</div>
                  : items.map(t => <TaskCard key={t.id} task={t} agents={agents} onOpen={() => setSelectedTaskId(t.id)} />)
                }
              </div>
            </div>
          );
        })}
      </div>
      {showNew && <NewTaskModal agents={agents} onCreate={async (title, desc, agentId) => { await createTask(title, desc, agentId, currentProjectId ?? undefined); setShowNew(false); }} onClose={() => setShowNew(false)} />}
      {selectedTaskId && (
        <TaskDetailModal
          task={tasks.find(t => t.id === selectedTaskId)}
          agents={agents}
          onClose={() => setSelectedTaskId(null)}
          onStatusChange={(status) => updateTask(selectedTaskId, status)}
        />
      )}
    </div>
  );
}

function TaskCard({ task, agents, onOpen }: { task: TaskData; agents: AgentData[]; onOpen: () => void }) {
  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;

  return (
    <button type="button" onClick={onOpen} style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, cursor: 'pointer', transition: 'box-shadow 0.15s', textAlign: 'left', color: 'var(--text-1)' }}>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, marginBottom: 8 }}>{task.title}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ padding: '2px 7px', borderRadius: 4, background: source.bg, color: source.color, fontWeight: 600, fontSize: 10 }}>{source.label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{task.stage || task.status}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {agent ? (
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: TYPE_COLORS[agent.type] ?? '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: 'white' }} title={agent.name}>{agent.name.charAt(0)}</div>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>未指派</span>
        )}
        {task.description && <span style={{ fontSize: 10, color: 'var(--text-3)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.description}</span>}
      </div>
    </button>
  );
}

function TaskDetailModal({ task, agents, onClose, onStatusChange }: { task: TaskData | undefined; agents: AgentData[]; onClose: () => void; onStatusChange: (status: string) => Promise<TaskData> }) {
  const [updating, setUpdating] = useState<string | null>(null);
  if (!task) return null;

  const source = SOURCE_META[task.source] ?? SOURCE_META.human;
  const agent = task.assigned_agent_id ? agents.find(a => a.id === task.assigned_agent_id) : null;
  const detailStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 12, alignItems: 'start' };

  const changeStatus = async (status: string) => {
    setUpdating(status);
    try {
      await onStatusChange(status);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.24)', zIndex: 1000 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 92vw)', background: 'var(--bg-0)', borderLeft: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 22, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <h2 style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>任务详情</h2>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={15} /></button>
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.45, marginBottom: 10 }}>{task.title}</div>
        <div style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.7, marginBottom: 18, whiteSpace: 'pre-wrap' }}>{task.description || '暂无描述'}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', marginBottom: 18 }}>
          <DetailRow label="状态" value={task.status} />
          <DetailRow label="阶段" value={task.stage || '未设置'} />
          <div style={detailStyle}><span style={{ color: 'var(--text-3)' }}>指派 Agent</span><span>{agent ? `${agent.name} (${agent.runtime})` : task.assigned_agent_id || '未指派'}</span></div>
          <div style={detailStyle}><span style={{ color: 'var(--text-3)' }}>来源</span><span style={{ width: 'fit-content', padding: '2px 7px', borderRadius: 4, background: source.bg, color: source.color, fontWeight: 600 }}>{source.label} ({task.source})</span></div>
          <DetailRow label="创建时间" value={formatDateTime(task.created_at)} />
          <DetailRow label="Session" value={task.sessionId || '未关联'} />
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>人工状态操作</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {STATUS_ACTIONS.map(action => (
            <button key={action.status} type="button" onClick={() => changeStatus(action.status)} disabled={updating !== null || task.status === action.status} style={{ padding: '8px 12px', borderRadius: 8, border: task.status === action.status ? '1px solid var(--blue)' : '1px solid var(--border)', background: task.status === action.status ? 'var(--blue-light)' : 'var(--bg-0)', color: task.status === action.status ? 'var(--blue)' : 'var(--text-2)', fontSize: 12, cursor: task.status === action.status ? 'default' : 'pointer', opacity: updating && updating !== action.status ? 0.6 : 1 }}>
              {updating === action.status ? '更新中...' : action.label}
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 10, fontSize: 12 }}><span style={{ color: 'var(--text-3)' }}>{label}</span><span style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{value}</span></div>;
}

function formatDateTime(iso: string): string { try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso; } }

function NewTaskModal({ agents, onCreate, onClose }: { agents: AgentData[]; onCreate: (t: string, d?: string, a?: string) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const st: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box' };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 440, background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>新建任务</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="任务标题" style={st} />
          <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="描述（可选）" rows={3} style={{ ...st, resize: 'vertical' }} />
          <select value={agentId} onChange={e => setAgentId(e.target.value)} style={st}>
            <option value="">不指派 Agent</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { if (title.trim()) onCreate(title, desc || undefined, agentId || undefined) }} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>创建</button>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      </div>
    </>
  );
}
