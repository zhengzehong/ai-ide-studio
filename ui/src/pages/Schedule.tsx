import { useState } from 'react';
import { Plus, Clock, Zap, Trash2, ToggleLeft, ToggleRight, Calendar, HelpCircle } from 'lucide-react';
import { useRuleStore, type RuleData } from '../stores/rule.store';
import { useAgentStore } from '../stores/agent.store';

const CRON_TEMPLATES = [
  { label: '每分钟', cron: '* * * * *' },
  { label: '每30分钟', cron: '*/30 * * * *' },
  { label: '每小时', cron: '0 * * * *' },
  { label: '每天 9:00', cron: '0 9 * * *' },
  { label: '每周一 9:00', cron: '0 9 * * 1' },
  { label: '每月1号 0:00', cron: '0 0 1 * *' },
];

function describeCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;

  const [min, hour, dom, month, dow] = fields;

  if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') return '每分钟';
  if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') return '每小时整点';
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    return `每 ${min.slice(2)} 分钟`;
  }
  if (min === '0' && hour !== '*' && !hour.includes(',') && dom === '*' && month === '*' && dow === '*') {
    return `每天 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min === '0' && hour !== '*' && dom === '*' && month === '*' && dow !== '*') {
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const days = dow.split(',').map(d => dayNames[parseInt(d)] || d).join(',');
    return `每${days} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min === '0' && hour !== '*' && dom !== '*' && month === '*' && dow === '*') {
    return `每月 ${dom} 号 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }

  return cron;
}

export default function Schedule() {
  const rules = useRuleStore(s => s.rules);
  const createRule = useRuleStore(s => s.createRule);
  const toggleRule = useRuleStore(s => s.toggleRule);
  const deleteRule = useRuleStore(s => s.deleteRule);
  const [showNew, setShowNew] = useState(false);

  const cronRules = rules.filter(r => r.action === 'create_task');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>自动化规则</h1>
        <button
          onClick={() => setShowNew(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}
        >
          <Plus size={14} /> 新建规则
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={16} /> 定时任务 ({cronRules.length})
          </h2>

          {cronRules.length === 0 ? (
            <EmptyState text="暂无定时任务规则，点击「新建规则」创建第一条" />
          ) : (
            <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-0)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 160px 140px 140px 80px', padding: '10px 16px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
                <span style={{ textAlign: 'center' }}>启用</span>
                <span>规则名称</span>
                <span>Cron 表达式</span>
                <span>上次运行</span>
                <span>下次运行</span>
                <span style={{ textAlign: 'center' }}>操作</span>
              </div>
              {cronRules.map(r => (
                <RuleRow key={r.id} rule={r} onToggle={(enabled) => toggleRule(r.id, enabled)} onDelete={() => deleteRule(r.id)} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={16} /> 事件触发规则
          </h2>
          <EmptyState text="事件触发规则将在后续版本中支持" />
        </section>
      </div>

      {showNew && <NewRuleModal onCreate={async (input) => { await createRule(input); setShowNew(false); }} onClose={() => setShowNew(false)} />}
    </div>
  );
}

function RuleRow({ rule, onToggle, onDelete }: { rule: RuleData; onToggle: (enabled: boolean) => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);

  const formatTime = (iso: string | null) => {
    if (!iso) return <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>;
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    if (diff < 60_000) return <span style={{ color: 'var(--green)', fontSize: 12 }}>刚刚</span>;
    if (diff < 3_600_000) return <span style={{ fontSize: 12 }}>{Math.floor(diff / 60_000)} 分钟前</span>;
    if (diff < 86_400_000) return <span style={{ fontSize: 12 }}>{Math.floor(diff / 3_600_000)} 小时前</span>;

    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hour = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    return <span style={{ fontSize: 12 }}>{month}-{day} {hour}:{min}</span>;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 160px 140px 140px 80px', padding: '10px 16px', borderBottom: '1px solid var(--border-light)', alignItems: 'center', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }} onClick={() => onToggle(!rule.enabled)}>
        {rule.enabled
          ? <ToggleRight size={20} color="var(--blue)" />
          : <ToggleLeft size={20} color="var(--text-3)" />
        }
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{rule.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>→ {rule.action_config.title}</div>
        {rule.description && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{rule.description}</div>}
      </div>

      <div>
        <span style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>{rule.cron}</span>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{describeCron(rule.cron)}</div>
      </div>

      <div>{formatTime(rule.last_run_at)}</div>

      <div>
        {rule.next_run_at
          ? formatTime(rule.next_run_at)
          : rule.enabled
            ? <span style={{ color: 'var(--yellow)', fontSize: 12 }}>待计算</span>
            : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
        }
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
        {confirming ? (
          <>
            <button
              onClick={() => { onDelete(); setConfirming(false); }}
              style={{ padding: '3px 8px', borderRadius: 4, border: 'none', background: 'var(--red)', color: 'white', fontSize: 11, cursor: 'pointer' }}
            >
              确认
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer' }}
            >
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            style={{ padding: 4, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}
            title="删除规则"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function NewRuleModal({ onCreate, onClose }: { onCreate: (input: { name: string; cron: string; action: string; actionConfig: { title: string; description?: string; assignAgentId?: string } }) => Promise<void>; onClose: () => void }) {
  const agents = useAgentStore(s => s.agents);
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [agentId, setAgentId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const st: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)',
    color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box',
  };

  const handleCreate = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = '请输入规则名称';
    const cronFields = cron.trim().split(/\s+/);
    if (cronFields.length !== 5) errs.cron = 'Cron 表达式需要 5 个字段 (分 时 日 月 周)';
    if (!taskTitle.trim()) errs.taskTitle = '请输入任务标题';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    await onCreate({
      name: name.trim(),
      cron: cron.trim(),
      action: 'create_task',
      actionConfig: {
        title: taskTitle.trim(),
        description: taskDesc.trim() || undefined,
        assignAgentId: agentId || undefined,
      },
    });
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 480, maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} /> 新建定时规则
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>规则名称 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：每日站会提醒" style={{ ...st, borderColor: errors.name ? 'var(--red)' : 'var(--border)' }} />
            {errors.name && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{errors.name}</div>}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block', alignItems: 'center', gap: 6 }}>
              Cron 表达式 *
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-3)', fontWeight: 400, marginLeft: 6 }}>
                <HelpCircle size={12} /> 分 时 日 月 周
              </span>
            </label>
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * *" style={{ ...st, fontFamily: 'monospace', borderColor: errors.cron ? 'var(--red)' : 'var(--border)' }} />
            {errors.cron && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{errors.cron}</div>}
            {cron.trim().split(/\s+/).length === 5 && !errors.cron && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} /> {describeCron(cron.trim())}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {CRON_TEMPLATES.map(t => (
                <button
                  key={t.cron}
                  onClick={() => { setCron(t.cron); setErrors({}); }}
                  style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: cron === t.cron ? 'var(--blue-light)' : 'var(--bg-1)', color: cron === t.cron ? 'var(--blue)' : 'var(--text-2)', fontSize: 11, cursor: 'pointer' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>触发任务标题 *</label>
            <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Agent 将创建此任务" style={{ ...st, borderColor: errors.taskTitle ? 'var(--red)' : 'var(--border)' }} />
            {errors.taskTitle && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 2 }}>{errors.taskTitle}</div>}
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>任务描述（可选）</label>
            <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="补充任务详情" rows={2} style={{ ...st, resize: 'vertical' }} />
          </div>

          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>指派 Agent（可选）</label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} style={st}>
              <option value="">不指派</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={handleCreate} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>创建规则</button>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      </div>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 20px', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
      {text}
    </div>
  );
}
