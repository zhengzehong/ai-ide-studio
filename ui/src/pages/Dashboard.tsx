import { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Plus,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import { useAgentStore, type AgentData } from '../stores/agent.store';
import { useSessionStore } from '../stores/session.store';
import { useTaskStore } from '../stores/task.store';
import { useConnectionStore } from '../stores/connection.store';

type ModalType = null | 'task' | 'agent';
const TYPE_COLORS: Record<string, string> = { dev: '#2563eb', test: '#059669', ops: '#ea580c', security: '#dc2626', architect: '#7c3aed', pm: '#7c3aed' };

export default function Dashboard() {
  const [modal, setModal] = useState<ModalType>(null);
  const connected = useConnectionStore(s => s.connected);
  const agents = useAgentStore(s => s.agents);
  const createAgent = useAgentStore(s => s.createAgent);
  const sessions = useSessionStore(s => s.sessions);
  const tasks = useTaskStore(s => s.tasks);
  const createTask = useTaskStore(s => s.createTask);
  const fetchTasks = useTaskStore(s => s.fetchTasks);

  const activeSessions = sessions.filter(s => s.status === 'active').length;
  const runningAgents = agents.filter(a => a.status === 'running').length;
  const inProgressTasks = tasks.filter(t => t.status === 'executing' || t.status === 'planning').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '28px 32px', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>项目概览</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {connected ? <Wifi size={13} color="var(--green)" /> : <WifiOff size={13} color="var(--red)" />}
            <p style={{ fontSize: 14, color: 'var(--text-2)', margin: 0 }}>
              {connected ? `${runningAgents} 个智能体运行中，${activeSessions} 个活跃会话` : '未连接到后端 Gateway'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ActionBtn icon={<Plus size={14} />} label="新建任务" onClick={() => setModal('task')} primary />
          <ActionBtn icon={<Bot size={14} />} label="新建 Agent" onClick={() => setModal('agent')} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <StatCard icon={<Bot size={18} />} label="运行中 Agent" value={runningAgents} color="var(--blue)" bg="var(--blue-light)" />
        <StatCard icon={<Loader2 size={18} />} label="进行中任务" value={inProgressTasks} color="var(--purple)" bg="var(--purple-light)" />
        <StatCard icon={<CheckCircle2 size={18} />} label="已完成任务" value={completedTasks} color="var(--green)" bg="var(--green-light)" />
        <StatCard icon={<AlertCircle size={18} />} label="活跃会话" value={activeSessions} color="var(--orange)" bg="var(--orange-light)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24 }}>
        <div>
          <SectionHeader icon={<Activity size={15} />} title="智能体状态" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
            {agents.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 20, textAlign: 'center' }}>暂无 Agent</div>}
            {agents.map(agent => {
              const agentSessions = sessions.filter(s => s.agent_id === agent.id && s.status === 'active');
              return (
                <div key={agent.id} style={{ padding: '14px 16px', background: 'var(--bg-0)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: TYPE_COLORS[agent.type] ?? '#6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{agent.name.charAt(0)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{agent.name}</span>
                      <StatusBadge status={agent.status} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{agent.runtime} · {agentSessions.length} 个活跃会话</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{agent.type}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <SectionHeader icon={<MessageSquare size={15} />} title="任务列表" action="查看看板" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.length === 0 && <div style={{ color: 'var(--text-3)', fontSize: 13, padding: 20, textAlign: 'center' }}>暂无任务</div>}
            {tasks.slice(0, 6).map(task => (
              <div key={task.id} style={{ padding: '14px 16px', background: 'var(--bg-0)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1, marginRight: 12 }}>{task.title}</span>
                  <TaskStatusBadge status={task.status} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{task.stage || task.status}</span>
                  {task.assigned_agent_id && (
                    <span style={{ fontSize: 11, color: 'var(--text-3)', background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 4 }}>{task.assigned_agent_id}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionHeader icon={<Zap size={15} />} title="快捷操作" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
            <QuickAction icon={<Plus size={16} />} label="新建任务" onClick={() => setModal('task')} />
            <QuickAction icon={<Bot size={16} />} label="新建 Agent" onClick={() => setModal('agent')} />
          </div>

          <SectionHeader icon={<Activity size={15} />} title="活跃会话" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sessions.filter(s => s.status === 'active').length === 0 && (
              <div style={{ color: 'var(--text-3)', fontSize: 12, textAlign: 'center', padding: 20 }}>暂无活跃会话</div>
            )}
            {sessions.filter(s => s.status === 'active').slice(0, 8).map(s => {
              const agent = agents.find(a => a.id === s.agent_id);
              return (
                <div key={s.id} style={{ padding: '10px 12px', background: 'var(--bg-0)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: agent ? (TYPE_COLORS[agent.type] ?? '#6b7280') : 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'white', flexShrink: 0 }}>{agent?.name.charAt(0) ?? '?'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{agent?.name ?? s.agent_id}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.id.slice(-8)} · {formatTime(s.started_at)}</div>
                  </div>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#059669', flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {modal === 'task' && <NewTaskModal agents={agents} onCreate={async (t, d, a) => { await createTask(t, d, a); await fetchTasks(); setModal(null); }} onClose={() => setModal(null)} />}
      {modal === 'agent' && <NewAgentModal onCreate={async (name, type, runtime) => { await createAgent(name, type, runtime); setModal(null); }} onClose={() => setModal(null)} />}
    </div>
  );
}

function NewTaskModal({ agents, onCreate, onClose }: { agents: AgentData[]; onCreate: (t: string, d?: string, a?: string) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  return (
    <Modal title="新建任务" onClose={onClose}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>任务标题</label>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如: 实现用户登录功能" style={inputStyle} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>描述</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="详细描述需求..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>指派 Agent</label>
        <select value={agentId} onChange={e => setAgentId(e.target.value)} style={inputStyle}>
          <option value="">不指派</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <ModalBtn label="创建任务" primary onClick={() => onCreate(title, desc || undefined, agentId || undefined)} />
        <ModalBtn label="取消" onClick={onClose} />
      </div>
    </Modal>
  );
}

function NewAgentModal({ onCreate, onClose }: { onCreate: (name: string, type: string, runtime: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('dev');
  const [runtime, setRuntime] = useState('mock');
  return (
    <Modal title="新建 Agent" onClose={onClose}>
      <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>名称</label><input value={name} onChange={e => setName(e.target.value)} placeholder="例如: Code Review Agent" style={inputStyle} /></div>
      <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>类型</label><select value={type} onChange={e => setType(e.target.value)} style={inputStyle}><option value="dev">开发</option><option value="test">测试</option><option value="ops">运维</option><option value="security">安全</option><option value="architect">架构</option><option value="pm">产品</option></select></div>
      <div><label style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', display: 'block', marginBottom: 5 }}>Runtime</label><select value={runtime} onChange={e => setRuntime(e.target.value)} style={inputStyle}><option value="mock">Mock</option><option value="claude">Claude</option><option value="codex">Codex</option></select></div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <ModalBtn label="创建 Agent" primary onClick={() => onCreate(name, type, runtime)} />
        <ModalBtn label="取消" onClick={onClose} />
      </div>
    </Modal>
  );
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, outline: 'none', background: 'var(--bg-1)', color: 'var(--text-1)', boxSizing: 'border-box' };

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 440, background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={14} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
      </div>
    </>
  );
}

function ModalBtn({ label, primary, onClick }: { label: string; primary?: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--blue)' : 'var(--bg-0)', color: primary ? 'white' : 'var(--text-2)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>{label}</button>;
}

function ActionBtn({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 'var(--radius)', border: primary ? 'none' : '1px solid var(--border)', background: primary ? 'var(--blue)' : 'var(--bg-0)', color: primary ? 'white' : 'var(--text-1)', fontSize: 13, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>{icon}{label}</button>;
}

function StatCard({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div style={{ padding: '18px 20px', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>{icon}</div>
      <div><div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div><div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>{label}</div></div>
    </div>
  );
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><span style={{ color: 'var(--text-3)' }}>{icon}</span>{title}</div>
      {action && <button style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--blue)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }}>{action} <ArrowRight size={12} /></button>}
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-1)', fontSize: 13, cursor: 'pointer' }}><span style={{ color: 'var(--text-3)' }}>{icon}</span>{label}</button>;
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { bg: string; color: string; label: string }> = { running: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '运行中' }, idle: { bg: 'var(--green-light)', color: 'var(--green)', label: '空闲' }, standby: { bg: 'var(--bg-2)', color: 'var(--text-3)', label: '待机' }, sleeping: { bg: 'var(--bg-2)', color: 'var(--text-3)', label: '休眠' } };
  const s = m[status] ?? m.standby;
  return <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: s.bg, color: s.color, fontWeight: 500 }}>{s.label}</span>;
}

function TaskStatusBadge({ status }: { status: string }) {
  const m: Record<string, { bg: string; color: string; label: string }> = { executing: { bg: 'var(--blue-light)', color: 'var(--blue)', label: '进行中' }, planning: { bg: 'var(--purple-light)', color: 'var(--purple)', label: '规划中' }, reviewing: { bg: 'var(--yellow-light)', color: 'var(--yellow)', label: '审查中' }, blocked: { bg: 'var(--red-light)', color: 'var(--red)', label: '已阻塞' }, completed: { bg: 'var(--green-light)', color: 'var(--green)', label: '已完成' }, backlog: { bg: 'var(--bg-2)', color: 'var(--text-3)', label: '待办' } };
  const s = m[status] ?? m.backlog;
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.color, fontWeight: 500, flexShrink: 0 }}>{s.label}</span>;
}

function formatTime(iso: string): string { try { return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); } catch { return iso; } }
