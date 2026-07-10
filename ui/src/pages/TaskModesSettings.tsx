import { useEffect, useState } from 'react';
import { Plus, X, Trash2, Edit3 } from 'lucide-react';
import { useTaskStore, type TaskExecutionModeData } from '../stores/task.store';
import { useProjectStore } from '../stores/project.store';

const BUILTIN_BADGE = '内置';

export default function TaskModesSettings() {
  const modes = useTaskStore(s => s.modes);
  const fetchModes = useTaskStore(s => s.fetchModes);
  const createMode = useTaskStore(s => s.createMode);
  const updateMode = useTaskStore(s => s.updateMode);
  const deleteMode = useTaskStore(s => s.deleteMode);
  const currentProjectId = useProjectStore(s => s.currentProjectId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchModes(currentProjectId ?? undefined);
  }, [currentProjectId, fetchModes]);

  const sorted = [...modes].sort((a, b) => {
    if (a.is_builtin !== b.is_builtin) return a.is_builtin ? -1 : 1;
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700 }}>执行模式管理</h1>
        <button onClick={() => setCreating(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: 'var(--blue)', color: 'white', fontSize: 15, fontWeight: 500, cursor: 'pointer', boxShadow: 'var(--shadow-sm)' }}>
          <Plus size={14} /> 新建模式
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sorted.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 14, padding: '40px' }}>暂无执行模式</div>
        )}
        {sorted.map(mode => (
          <ModeCard
            key={mode.id}
            mode={mode}
            isEditing={editingId === mode.id}
            onEdit={() => setEditingId(mode.id)}
            onCancelEdit={() => setEditingId(null)}
            onSave={async (fields) => {
              await updateMode(mode.id, fields);
              setEditingId(null);
            }}
            onDelete={async () => {
              if (!confirm(`确定删除模式「${mode.name}」？`)) return;
              await deleteMode(mode.id);
            }}
          />
        ))}
      </div>

      {creating && (
        <ModeEditModal
          title="新建执行模式"
          initialValues={{ name: '', description: '', promptTemplate: '', reportTemplate: '' }}
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            if (!values.name.trim()) return;
            await createMode({
              name: values.name.trim(),
              description: values.description.trim() || undefined,
              promptTemplate: values.promptTemplate,
              reportTemplate: values.reportTemplate,
              projectId: currentProjectId ?? undefined,
            });
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function ModeCard({ mode, isEditing, onEdit, onCancelEdit, onSave, onDelete }: {
  mode: TaskExecutionModeData;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (fields: { name: string; description: string; promptTemplate: string; reportTemplate: string }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  if (isEditing) {
    return (
      <ModeEditModal
        title={`编辑模式：${mode.name}`}
        initialValues={{
          name: mode.name,
          description: mode.description || '',
          promptTemplate: mode.prompt_template,
          reportTemplate: mode.report_template,
        }}
        onClose={onCancelEdit}
        onSave={async (values) => {
          await onSave(values);
        }}
      />
    );
  }

  return (
    <div style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 600, flex: 1 }}>{mode.name}</span>
        {mode.is_builtin && (
          <span style={{ padding: '2px 8px', borderRadius: 4, background: '#ede9fe', color: '#7c3aed', fontSize: 12, fontWeight: 600 }}>{BUILTIN_BADGE}</span>
        )}
        {!mode.is_builtin && (
          <>
            <button type="button" onClick={onEdit} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-1)', color: 'var(--text-2)', fontSize: 13, cursor: 'pointer' }}>
              <Edit3 size={12} /> 编辑
            </button>
            <button type="button" onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontSize: 13, cursor: 'pointer' }}>
              <Trash2 size={12} /> 删除
            </button>
          </>
        )}
      </div>
      {mode.description && <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>{mode.description}</div>}
      {mode.prompt_template && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>Prompt 模板</div>
          <pre style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'pre-wrap', margin: 0, maxHeight: 120, overflow: 'auto' }}>{mode.prompt_template}</pre>
        </div>
      )}
      {mode.report_template && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4 }}>汇报模板</div>
          <pre style={{ background: 'var(--bg-2)', padding: 8, borderRadius: 6, fontSize: 12, color: 'var(--text-2)', whiteSpace: 'pre-wrap', margin: 0, maxHeight: 120, overflow: 'auto' }}>{mode.report_template}</pre>
        </div>
      )}
    </div>
  );
}

function ModeEditModal({ title, initialValues, onClose, onSave }: {
  title: string;
  initialValues: { name: string; description: string; promptTemplate: string; reportTemplate: string };
  onClose: () => void;
  onSave: (values: { name: string; description: string; promptTemplate: string; reportTemplate: string }) => Promise<void>;
}) {
  const [name, setName] = useState(initialValues.name);
  const [description, setDescription] = useState(initialValues.description);
  const [promptTemplate, setPromptTemplate] = useState(initialValues.promptTemplate);
  const [reportTemplate, setReportTemplate] = useState(initialValues.reportTemplate);
  const [saving, setSaving] = useState(false);

  const st: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 14, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), promptTemplate, reportTemplate });
    } finally { setSaving(false); }
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 560, maxWidth: '96vw', maxHeight: '90vh', background: 'var(--bg-0)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', zIndex: 1001, padding: 24, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'var(--bg-2)', borderRadius: 6, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-2)' }}><X size={15} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>名称</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="如：问题修复 / 规划先行" style={st} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>描述（可选）</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="一句话说明该模式的用途" style={st} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Prompt 模板（可选）</label>
          <textarea value={promptTemplate} onChange={e => setPromptTemplate(e.target.value)} rows={5} style={{ ...st, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }} placeholder="指导 Agent 执行流程的 prompt，如：本任务为「问题修复」模式，请按以下流程执行..." />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>汇报模板（可选）</label>
          <textarea value={reportTemplate} onChange={e => setReportTemplate(e.target.value)} rows={5} style={{ ...st, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }} placeholder="Markdown 模板，如：## 根因分析 / ## 修复方案 / ## 验证结果" />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--bg-0)', color: 'var(--text-2)', fontSize: 14, cursor: 'pointer' }}>取消</button>
          <button onClick={handleSave} disabled={!name.trim() || saving} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', border: 'none', background: !name.trim() || saving ? 'var(--bg-2)' : 'var(--blue)', color: !name.trim() || saving ? 'var(--text-3)' : 'white', fontSize: 14, fontWeight: 500, cursor: !name.trim() || saving ? 'not-allowed' : 'pointer' }}>{saving ? '保存中...' : '保存'}</button>
        </div>
      </div>
    </>
  );
}
