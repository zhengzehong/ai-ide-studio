import { useState } from 'react';
import {
  Brain, Code, Search as SearchIcon, FileText, Server, TestTube, Shield,
  Plus, Pencil, Trash2, X, Save, ChevronLeft, Bot,
} from 'lucide-react';
import { useTemplateStore, type TemplateData, type CreateTemplateInput } from '../stores/template.store';

const ICON_MAP: Record<string, typeof Brain> = {
  brain: Brain, code: Code, search: SearchIcon, 'file-text': FileText,
  server: Server, 'test-tube': TestTube, shield: Shield, bot: Bot,
};

const TYPE_LABELS: Record<string, string> = {
  architect: '架构', dev: '开发', reviewer: '审查', tester: '测试', docs: '文档', ops: '运维',
};

const TYPE_FILTERS = [
  { value: '', label: '全部' },
  { value: 'architect', label: '架构' },
  { value: 'dev', label: '开发' },
  { value: 'reviewer', label: '审查' },
  { value: 'tester', label: '测试' },
  { value: 'docs', label: '文档' },
  { value: 'ops', label: '运维' },
];

const RUNTIME_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'mock', label: 'Mock' },
];

const ICON_OPTIONS = Object.keys(ICON_MAP);

export default function AgentSquare() {
  const templates = useTemplateStore((s) => s.templates);
  const createTemplate = useTemplateStore((s) => s.createTemplate);
  const updateTemplate = useTemplateStore((s) => s.updateTemplate);
  const deleteTemplate = useTemplateStore((s) => s.deleteTemplate);
  const getSkills = useTemplateStore((s) => s.getSkills);

  const [filterType, setFilterType] = useState('');
  const [searchText, setSearchText] = useState('');
  const [editing, setEditing] = useState<TemplateData | null>(null);
  const [creating, setCreating] = useState(false);

  const filtered = templates.filter((t) => {
    if (filterType && t.type !== filterType) return false;
    if (searchText && !t.name.includes(searchText) && !(t.description ?? '').includes(searchText)) return false;
    return true;
  });

  if (editing) {
    return <TemplateEditor template={editing} onSave={async (input) => { await updateTemplate(editing.id, input); setEditing(null); }} onCancel={() => setEditing(null)} />;
  }

  if (creating) {
    return <TemplateEditor onSave={async (input) => { await createTemplate(input); setCreating(false); }} onCancel={() => setCreating(false)} />;
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>Agent 广场</h1>
        <button onClick={() => setCreating(true)} style={btnPrimary}>
          <Plus size={16} /> 创建 Agent
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索 Agent..."
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterType(f.value)}
              style={{
                padding: '5px 12px', fontSize: 13, borderRadius: 16, border: '1px solid var(--border)',
                background: filterType === f.value ? 'var(--blue)' : 'var(--bg-0)',
                color: filterType === f.value ? '#fff' : 'var(--text-2)',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {filtered.map((tpl) => {
          const IconComp = ICON_MAP[tpl.icon] || Bot;
          const skills = getSkills(tpl);
          return (
            <div key={tpl.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={iconBadge}>
                  <IconComp size={22} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{tpl.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                    {tpl.runtime} · {TYPE_LABELS[tpl.type] || tpl.type}
                  </div>
                </div>
                {tpl.is_builtin ? (
                  <span style={builtinBadge}>内置</span>
                ) : (
                  <span style={customBadge}>自定义</span>
                )}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 12px', lineHeight: 1.5 }}>
                {tpl.description || '暂无描述'}
              </p>
              {skills.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  {skills.map((s) => (
                    <span key={s} style={skillTag}>{s}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button onClick={() => setEditing(tpl)} style={btnOutline}>
                  <Pencil size={13} /> 编辑
                </button>
                {!tpl.is_builtin && (
                  <button
                    onClick={() => { if (confirm(`确定删除 "${tpl.name}" 吗？`)) deleteTemplate(tpl.id); }}
                    style={{ ...btnOutline, color: 'var(--red, #ef4444)', borderColor: 'var(--red, #ef4444)' }}
                  >
                    <Trash2 size={13} /> 删除
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
          <Bot size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <p>暂无匹配的 Agent 模板</p>
        </div>
      )}
    </div>
  );
}

function TemplateEditor({ template, onSave, onCancel }: {
  template?: TemplateData;
  onSave: (input: CreateTemplateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState(template?.type ?? 'dev');
  const [runtime, setRuntime] = useState(template?.runtime ?? 'claude');
  const [icon, setIcon] = useState(template?.icon ?? 'bot');
  const [systemPrompt, setSystemPrompt] = useState(template?.system_prompt ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [skillsText, setSkillsText] = useState(() => {
    if (!template?.skills_json) return '';
    try { return (JSON.parse(template.skills_json) as string[]).join(', '); } catch { return ''; }
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const skills = skillsText.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    await onSave({ name, agentType: type, runtime, icon, systemPrompt, description: description || undefined, skills: skills.length > 0 ? skills : undefined });
    setSaving(false);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onCancel} style={{ ...btnOutline, padding: '4px 8px' }}>
            <ChevronLeft size={16} /> 返回广场
          </button>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text-1)' }}>
            {template ? `编辑 Agent: ${template.name}` : '创建新 Agent'}
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={btnOutline}><X size={14} /> 取消</button>
          <button onClick={handleSubmit} disabled={saving || !name.trim()} style={{ ...btnPrimary, opacity: saving || !name.trim() ? 0.5 : 1 }}>
            <Save size={14} /> {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '320px 1fr', gap: 0 }}>
        {/* 左侧基本信息 */}
        <div style={{ padding: 24, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="名称">
            <input value={name} onChange={(e) => setName(e.target.value)} style={editorInput} placeholder="如：架构师" />
          </Field>
          <Field label="类型">
            <select value={type} onChange={(e) => setType(e.target.value)} style={editorInput}>
              {TYPE_FILTERS.filter((f) => f.value).map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </Field>
          <Field label="运行时">
            <select value={runtime} onChange={(e) => setRuntime(e.target.value)} style={editorInput}>
              {RUNTIME_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="图标">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ICON_OPTIONS.map((ic) => {
                const Ic = ICON_MAP[ic] || Bot;
                return (
                  <button
                    key={ic}
                    onClick={() => setIcon(ic)}
                    type="button"
                    style={{
                      width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: icon === ic ? '2px solid var(--blue)' : '1px solid var(--border)',
                      background: icon === ic ? 'var(--blue-light)' : 'var(--bg-0)',
                      color: icon === ic ? 'var(--blue)' : 'var(--text-3)', cursor: 'pointer',
                    }}
                  >
                    <Ic size={18} />
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...editorInput, height: 60, resize: 'vertical' }}
              placeholder="一句话描述 Agent 的能力"
            />
          </Field>
          <Field label="技能标签">
            <input
              value={skillsText}
              onChange={(e) => setSkillsText(e.target.value)}
              style={editorInput}
              placeholder="用逗号分隔，如：系统设计, API 设计"
            />
          </Field>
        </div>

        {/* 右侧提示词编辑器 */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>系统提示词</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            style={{
              flex: 1, fontFamily: 'var(--font-mono, "Fira Code", monospace)', fontSize: 13,
              lineHeight: 1.6, padding: 16, borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-2)', color: 'var(--text-1)', resize: 'none', outline: 'none',
            }}
            placeholder="编写 Agent 的系统提示词...&#10;&#10;例如：&#10;你是一位资深系统架构师。你的核心职责：&#10;- 分析需求并设计系统架构&#10;- 技术选型和方案评估"
          />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            提示词将作为 system prompt 传入 ACP Agent，指导 Agent 的行为和回复方式。
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: 20, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-0)',
  display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s, border-color 0.15s',
};

const iconBadge: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--blue-light)', color: 'var(--blue)', flexShrink: 0,
};

const builtinBadge: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-3)', color: 'var(--text-3)', fontWeight: 500,
};

const customBadge: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'var(--blue-light)', color: 'var(--blue)', fontWeight: 500,
};

const skillTag: React.CSSProperties = {
  fontSize: 11, padding: '2px 8px', borderRadius: 8, background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 500,
};

const btnPrimary: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: 13, fontWeight: 600,
  background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};

const btnOutline: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 13,
  background: 'var(--bg-0)', color: 'var(--text-2)', border: '1px solid var(--border)',
  borderRadius: 6, cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  width: '100%', height: 36, padding: '0 14px 0 32px', fontSize: 13,
  border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-0)',
  color: 'var(--text-1)', outline: 'none',
};

const editorInput: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid var(--border)',
  borderRadius: 6, background: 'var(--bg-0)', color: 'var(--text-1)', outline: 'none',
};
