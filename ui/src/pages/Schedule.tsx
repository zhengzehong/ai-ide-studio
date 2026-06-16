import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import { Plus, Clock, Trash2, ToggleLeft, ToggleRight, Calendar, HelpCircle, Play, Edit2, ChevronDown, ChevronRight, CheckCircle2, XCircle, Send } from 'lucide-react';
import { useRuleStore, type RuleData, type RuleExecution } from '../stores/rule.store';
import { useAgentStore } from '../stores/agent.store';
import { useSessionStore, type SessionData } from '../stores/session.store';
import { useProjectStore } from '../stores/project.store';

type SessionMode = 'existing' | 'new_each' | 'new_fixed';

const SESSION_MODE_OPTIONS: Array<{ value: SessionMode; label: string }> = [
  { value: 'new_fixed', label: '固定新会话' },
  { value: 'new_each', label: '每次新会话' },
  { value: 'existing', label: '指定已有会话' },
];

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
  if (min.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`;
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow === '*') return `每天 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dow !== '*' && dom === '*') {
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
    const days = dow.split(',').map(d => dayNames[parseInt(d)] || d).join(',');
    return `每周${days} ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (dom !== '*' && month === '*' && dow === '*') return `每月${dom}号 ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return cron;
}

function formatTime(iso: string | null) {
  if (!iso) return <span style={{ color: 'var(--text-3)', fontSize: 14 }}>—</span>;
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < 60_000) return <span style={{ color: 'var(--green)', fontSize: 14 }}>刚刚</span>;
  if (diff >= 0 && diff < 3_600_000) return <span style={{ fontSize: 14 }}>{Math.floor(diff / 60_000)} 分钟前</span>;
  if (diff >= 0 && diff < 86_400_000) return <span style={{ fontSize: 14 }}>{Math.floor(diff / 3_600_000)} 小时前</span>;
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hour = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return <span style={{ fontSize: 14 }}>{month}-{day} {hour}:{min}</span>;
}

export default function Schedule() {
  const rules = useRuleStore(s => s.rules);
  const fetchRules = useRuleStore(s => s.fetchRules);
  const toggleRule = useRuleStore(s => s.toggleRule);
  const deleteRule = useRuleStore(s => s.deleteRule);
  const runNow = useRuleStore(s => s.runNow);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<RuleData | null>(null);

  useEffect(() => {
    fetchRules(currentProjectId ?? undefined);
  }, [currentProjectId, fetchRules]);

  const handleEdit = (rule: RuleData) => {
    setEditingRule(rule);
    setShowModal(true);
  };

  const handleNew = () => {
    setEditingRule(null);
    setShowModal(true);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>自动化规则</h1>
          <p style={{ fontSize: 14, color: 'var(--text-3)', margin: '4px 0 0' }}>
            共 {rules.length} 条规则，{rules.filter(r => r.enabled).length} 条启用中
          </p>
        </div>
        <button onClick={handleNew} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 15, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
          <Plus size={14} /> 新建规则
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {rules.length === 0 ? (
          <EmptyState text="暂无定时规则，点击「新建规则」创建第一条" />
        ) : (
          <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg-0)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 140px 100px 100px 100px 100px 120px', padding: '10px 16px', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>
              <span style={{ textAlign: 'center' }}>启用</span>
              <span>规则</span>
              <span>Cron</span>
              <span>动作</span>
              <span>执行统计</span>
              <span>上次运行</span>
              <span>下次运行</span>
              <span style={{ textAlign: 'center' }}>操作</span>
            </div>
            {rules.map(r => (
              <RuleRow key={r.id} rule={r} onToggle={(en) => toggleRule(r.id, en)} onDelete={() => deleteRule(r.id)} onEdit={() => handleEdit(r)} onRunNow={() => runNow(r.id)} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <RuleModal
          editRule={editingRule}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function RuleRow({ rule, onToggle, onDelete, onEdit, onRunNow }: {
  rule: RuleData; onToggle: (enabled: boolean) => void; onDelete: () => void; onEdit: () => void; onRunNow: () => void
}) {
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [executions, setExecutions] = useState<RuleExecution[]>([]);
  const fetchExecutions = useRuleStore(s => s.fetchExecutions);

  const toggleExpand = async () => {
    if (!expanded) {
      const data = await fetchExecutions(rule.id, 10);
      setExecutions(data);
    }
    setExpanded(!expanded);
  };

  const actionLabel = rule.action === 'send_prompt' ? '发送 Prompt' : '创建任务';

  return (
    <div style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr 140px 100px 100px 100px 100px 120px', padding: '10px 16px', alignItems: 'center', fontSize: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }} onClick={() => onToggle(!rule.enabled)}>
          {rule.enabled ? <ToggleRight size={20} color="var(--blue)" /> : <ToggleLeft size={20} color="var(--text-3)" />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={toggleExpand}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{rule.name}</div>
            {rule.description && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{rule.description}</div>}
          </div>
        </div>

        <div>
          <span style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 4 }}>{rule.cron}</span>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{describeCron(rule.cron)}</div>
        </div>

        <div>
          <span style={{ fontSize: 13, padding: '2px 8px', borderRadius: 10, background: rule.action === 'send_prompt' ? 'var(--purple-light, #f3e8ff)' : 'var(--blue-light, #eff6ff)', color: rule.action === 'send_prompt' ? 'var(--purple, #7c3aed)' : 'var(--blue)' }}>
            {actionLabel}
          </span>
        </div>

        <div style={{ fontSize: 14 }}>
          <span style={{ color: 'var(--green)' }}>{rule.run_count}</span>
          {' / '}
          <span style={{ color: rule.fail_count > 0 ? 'var(--red)' : 'var(--text-3)' }}>{rule.fail_count}</span>
        </div>

        <div>{formatTime(rule.last_run_at)}</div>

        <div>{formatTime(rule.next_run_at)}</div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
          <button onClick={onEdit} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }} title="编辑">
            <Edit2 size={14} />
          </button>
          <button onClick={onRunNow} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }} title="立即执行">
            <Play size={14} />
          </button>
          {confirming ? (
            <>
              <button onClick={() => { onDelete(); setConfirming(false); }} style={{ padding: '2px 6px', borderRadius: 4, border: 'none', background: 'var(--red)', color: 'white', fontSize: 12, cursor: 'pointer' }}>确认</button>
              <button onClick={() => setConfirming(false)} style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-0)', fontSize: 12, cursor: 'pointer' }}>取消</button>
            </>
          ) : (
            <button onClick={() => setConfirming(true)} style={{ padding: 4, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }} title="删除">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '8px 16px 12px 64px', background: 'var(--bg-1)', borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>执行历史（最近 10 条）</div>
          {executions.length === 0 ? (
            <div style={{ fontSize: 14, color: 'var(--text-3)' }}>暂无执行记录</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {executions.map(ex => (
                <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  {ex.status === 'success' ? <CheckCircle2 size={12} color="var(--green)" /> : <XCircle size={12} color="var(--red)" />}
                  <span style={{ color: 'var(--text-2)', minWidth: 120 }}>{new Date(ex.triggered_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  {ex.task_id && <span style={{ color: 'var(--text-3)' }}>任务: {ex.task_id}</span>}
                  {ex.session_id && <span style={{ color: 'var(--text-3)' }}>会话: {ex.session_id}</span>}
                  {ex.error && <span style={{ color: 'var(--red)' }}>{ex.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuleModal({ editRule, onClose }: { editRule: RuleData | null; onClose: () => void }) {
  const agents = useAgentStore(s => s.agents);
  const sessions = useSessionStore(s => s.sessions);
  const createRule = useRuleStore(s => s.createRule);
  const updateRule = useRuleStore(s => s.updateRule);
  const currentProjectId = useProjectStore(s => s.currentProjectId);

  const isEdit = !!editRule;
  const [name, setName] = useState(editRule?.name ?? '');
  const [cron, setCron] = useState(editRule?.cron ?? '');
  const [action, setAction] = useState(editRule?.action ?? 'create_task');
  const [taskTitle, setTaskTitle] = useState((editRule?.action_config?.title as string) ?? '');
  const [taskDesc, setTaskDesc] = useState((editRule?.action_config?.description as string) ?? '');
  const [assignAgentId, setAssignAgentId] = useState((editRule?.action_config?.assign_agent_id as string) ?? '');
  const [sessionMode, setSessionMode] = useState<SessionMode>(readSessionMode(editRule?.action_config));
  const [sessionId, setSessionId] = useState((editRule?.action_config?.session_id as string) ?? '');
  const [prompt, setPrompt] = useState((editRule?.action_config?.prompt as string) ?? '');
  const [targetAgentId, setTargetAgentId] = useState((editRule?.action_config?.agent_id as string) ?? '');
  const [maxRuns, setMaxRuns] = useState(editRule?.max_runs?.toString() ?? '');
  const [description, setDescription] = useState(editRule?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const st: CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', fontSize: 15, background: 'var(--bg-1)',
    color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box',
  };
  const selectedAgentId = action === 'create_task' ? assignAgentId : targetAgentId;
  const targetSessions = useMemo(() => {
    if (!selectedAgentId) return [];
    return sessions.filter(s =>
      s.agent_id === selectedAgentId &&
      (!currentProjectId || s.project_id === currentProjectId),
    );
  }, [currentProjectId, selectedAgentId, sessions]);

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = '请输入规则名称';
    const cronFields = cron.trim().split(/\s+/);
    if (cronFields.length !== 5) errs.cron = 'Cron 表达式需要 5 个字段';
    if (action === 'create_task' && !taskTitle.trim()) errs.taskTitle = '请输入任务标题';
    if (action === 'send_prompt' && !prompt.trim()) errs.prompt = '请输入 Prompt 内容';
    if (action === 'send_prompt' && !targetAgentId) errs.targetAgentId = '请选择目标 Agent';
    if (selectedAgentId && sessionMode === 'existing' && !sessionId) errs.sessionId = '请选择已有会话';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const reusableSessionId = selectedAgentId && (sessionMode === 'existing' || sessionMode === 'new_fixed') ? sessionId || undefined : undefined;
    const actionConfig: Record<string, unknown> = action === 'create_task'
      ? { title: taskTitle.trim(), description: taskDesc.trim() || undefined, assign_agent_id: assignAgentId || undefined, session_mode: selectedAgentId ? sessionMode : undefined, session_id: reusableSessionId }
      : { prompt: prompt.trim(), agent_id: targetAgentId, session_mode: sessionMode, session_id: reusableSessionId };

    if (isEdit) {
      await updateRule(editRule!.id, {
        name: name.trim(),
        cron: cron.trim(),
        action,
        actionConfig,
        description: description.trim() || undefined,
        maxRuns: maxRuns ? parseInt(maxRuns) : undefined,
      });
    } else {
      await createRule({
        name: name.trim(),
        cron: cron.trim(),
        action,
        actionConfig,
        description: description.trim() || undefined,
        projectId: currentProjectId ?? undefined,
        maxRuns: maxRuns ? parseInt(maxRuns) : undefined,
      });
    }
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 520, maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} /> {isEdit ? '编辑定时规则' : '新建定时规则'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>规则名称 *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：每日站会提醒" style={{ ...st, borderColor: errors.name ? 'var(--red)' : 'var(--border)' }} />
            {errors.name && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{errors.name}</div>}
          </div>

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              Cron 表达式 *
              <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}><HelpCircle size={11} style={{ verticalAlign: 'middle' }} /> 分 时 日 月 周</span>
            </label>
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * *" style={{ ...st, fontFamily: 'monospace', borderColor: errors.cron ? 'var(--red)' : 'var(--border)' }} />
            {errors.cron && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{errors.cron}</div>}
            {cron.trim().split(/\s+/).length === 5 && !errors.cron && (
              <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 2 }}><Clock size={11} style={{ verticalAlign: 'middle' }} /> {describeCron(cron.trim())}</div>
            )}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
              {CRON_TEMPLATES.map(t => (
                <button key={t.cron} onClick={() => { setCron(t.cron); setErrors(prev => ({ ...prev, cron: '' })); }} style={{ padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border)', background: cron === t.cron ? 'var(--blue-light, #eff6ff)' : 'var(--bg-1)', color: cron === t.cron ? 'var(--blue)' : 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>动作类型</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAction('create_task')} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius)', border: `2px solid ${action === 'create_task' ? 'var(--blue)' : 'var(--border)'}`, background: action === 'create_task' ? 'var(--blue-light, #eff6ff)' : 'var(--bg-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
                <Clock size={16} /> 创建任务
              </button>
              <button onClick={() => setAction('send_prompt')} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius)', border: `2px solid ${action === 'send_prompt' ? 'var(--blue)' : 'var(--border)'}`, background: action === 'send_prompt' ? 'var(--blue-light, #eff6ff)' : 'var(--bg-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 15 }}>
                <Send size={16} /> 发送 Prompt
              </button>
            </div>
          </div>

          {action === 'create_task' && (
            <>
              <div>
                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>任务标题 *</label>
                <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="触发时创建的任务标题" style={{ ...st, borderColor: errors.taskTitle ? 'var(--red)' : 'var(--border)' }} />
                {errors.taskTitle && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{errors.taskTitle}</div>}
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>任务描述</label>
                <textarea value={taskDesc} onChange={e => setTaskDesc(e.target.value)} placeholder="补充任务详情" rows={2} style={{ ...st, resize: 'vertical' }} />
              </div>
              <div>
                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>指派 Agent</label>
                <select value={assignAgentId} onChange={e => { setAssignAgentId(e.target.value); setSessionMode('new_fixed'); setSessionId(''); }} style={st}>
                  <option value="">不指派</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {assignAgentId && (
                <SessionTargetSelect
                  mode={sessionMode}
                  sessionId={sessionId}
                  sessions={targetSessions}
                  onModeChange={(value) => { setSessionMode(value); setSessionId(''); }}
                  onSessionChange={setSessionId}
                  inputStyle={st}
                  error={errors.sessionId}
                />
              )}
            </>
          )}

          {action === 'send_prompt' && (
            <>
              <div>
                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>目标 Agent *</label>
                <select value={targetAgentId} onChange={e => { setTargetAgentId(e.target.value); setSessionMode('new_fixed'); setSessionId(''); }} style={{ ...st, borderColor: errors.targetAgentId ? 'var(--red)' : 'var(--border)' }}>
                  <option value="">请选择 Agent</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {errors.targetAgentId && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{errors.targetAgentId}</div>}
              </div>
              {targetAgentId && (
                <SessionTargetSelect
                  mode={sessionMode}
                  sessionId={sessionId}
                  sessions={targetSessions}
                  onModeChange={(value) => { setSessionMode(value); setSessionId(''); }}
                  onSessionChange={setSessionId}
                  inputStyle={st}
                  error={errors.sessionId}
                />
              )}
              <div>
                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>Prompt 内容 *</label>
                <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="发送给 Agent 的消息，支持 {date}、{time} 变量" rows={3} style={{ ...st, resize: 'vertical', borderColor: errors.prompt ? 'var(--red)' : 'var(--border)' }} />
                {errors.prompt && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{errors.prompt}</div>}
              </div>
            </>
          )}

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>最大执行次数</label>
            <input type="number" value={maxRuns} onChange={e => setMaxRuns(e.target.value)} placeholder="不限" style={st} min={1} />
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>达到后自动禁用规则，留空则不限</div>
          </div>

          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>描述</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="规则说明（可选）" style={st} />
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={handleSubmit} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 15, fontWeight: 500, cursor: 'pointer' }}>
              {isEdit ? '保存修改' : '创建规则'}
            </button>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 15, cursor: 'pointer' }}>取消</button>
          </div>
        </div>
      </div>
    </>
  );
}

function SessionTargetSelect({ mode, sessionId, sessions, onModeChange, onSessionChange, inputStyle, error }: {
  mode: SessionMode;
  sessionId: string;
  sessions: SessionData[];
  onModeChange: (value: SessionMode) => void;
  onSessionChange: (value: string) => void;
  inputStyle: CSSProperties;
  error?: string;
}) {
  return (
    <div>
      <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4, display: 'block' }}>会话目标</label>
      <select value={mode} onChange={e => onModeChange(e.target.value as SessionMode)} style={inputStyle}>
        {SESSION_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {mode === 'existing' && (
        <select value={sessionId} onChange={e => onSessionChange(e.target.value)} style={{ ...inputStyle, marginTop: 8, borderColor: error ? 'var(--red)' : inputStyle.borderColor }}>
          <option value="">请选择已有会话</option>
          {sessions.map(session => (
            <option key={session.id} value={session.id}>{sessionLabel(session)}</option>
          ))}
        </select>
      )}
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>
        {sessionModeDescription(mode, Boolean(sessionId))}
      </div>
      {error && <div style={{ fontSize: 13, color: 'var(--red)', marginTop: 2 }}>{error}</div>}
    </div>
  );
}

function readSessionMode(actionConfig?: Record<string, unknown>): SessionMode {
  const mode = actionConfig?.session_mode
  if (mode === 'existing' || mode === 'new_each' || mode === 'new_fixed') return mode
  return typeof actionConfig?.session_id === 'string' && actionConfig.session_id ? 'existing' : 'new_each'
}

function sessionModeDescription(mode: SessionMode, hasSession: boolean): string {
  if (mode === 'existing') return hasSession ? '触发时会复用该会话。' : '请选择一个已有会话。'
  if (mode === 'new_fixed') return '首次触发会创建固定会话，后续触发继续复用。'
  return '每次触发都会创建新的会话。'
}

function sessionLabel(session: SessionData): string {
  const title = session.title?.trim();
  return title ? title : `${session.id.slice(0, 8)}...`;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ padding: '32px 20px', background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', textAlign: 'center', color: 'var(--text-3)', fontSize: 15 }}>
      {text}
    </div>
  );
}
