import { useState, useEffect } from 'react';
import {
  Globe, Wrench, Terminal, Network, Code2, Database, Package,
  Plus, Pencil, Trash2, ToggleLeft, ToggleRight, ChevronDown,
  ChevronRight, Link, Unlink, Search, X,
} from 'lucide-react';
import { useToolStore, type ToolData, type ToolBindingData } from '../stores/tool.store';
import { useAgentStore } from '../stores/agent.store';
import { useProjectStore } from '../stores/project.store';

const CATEGORY_ICONS: Record<string, typeof Wrench> = {
  browser: Globe, filesystem: Terminal, network: Network,
  automation: Code2, code: Code2, data: Database, custom: Package,
};
const CATEGORY_LABELS: Record<string, string> = {
  browser: '浏览器', filesystem: '文件系统', network: '网络',
  automation: '自动化', code: '代码', data: '数据', custom: '自定义',
};
const TYPE_LABELS: Record<string, string> = { builtin: '内置', mcp: 'MCP 服务', script: '脚本' };

export default function ToolManager() {
  const { tools, bindings, fetchTools, createTool, updateTool, toggleTool, deleteTool, setBinding, removeBinding } = useToolStore();
  const agents = useAgentStore(s => s.agents);
  const projects = useProjectStore(s => s.projects);

  const [searchQ, setSearchQ] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTool, setEditTool] = useState<ToolData | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  useEffect(() => { fetchTools(); }, [fetchTools]);

  const filtered = tools.filter(t => {
    if (searchQ && !t.display_name.includes(searchQ) && !t.name.includes(searchQ) && !t.description.includes(searchQ)) return false;
    if (filterType && t.type !== filterType) return false;
    return true;
  });

  const getToolBindings = (toolId: string): ToolBindingData[] => bindings.filter(b => b.tool_id === toolId);

  return (
    <div style={{ padding: '28px 36px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>工具管理</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 14, margin: '6px 0 0' }}>注册、管理和绑定工具，支持 MCP 服务、脚本和内置工具</p>
        </div>
        <button onClick={() => { setEditTool(null); setShowCreate(true); }} style={btn}><Plus size={14} /> 注册工具</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {[
          { label: '全部', count: tools.length, color: 'var(--text-1)' },
          { label: '内置', count: tools.filter(t => t.is_builtin).length, color: '#16a34a' },
          { label: 'MCP', count: tools.filter(t => t.type === 'mcp').length, color: '#7c3aed' },
          { label: '脚本', count: tools.filter(t => t.type === 'script').length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: 'var(--bg-2)', fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
            <span style={{ color: 'var(--text-3)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div style={searchBox}>
          <Search size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="搜索工具..." style={searchInput} />
          {searchQ && <button onClick={() => setSearchQ('')} style={clearBtn}><X size={14} /></button>}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['', 'builtin', 'mcp', 'script'].map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{
              ...filterBtn,
              background: filterType === t ? 'var(--blue)' : 'var(--bg-2)',
              color: filterType === t ? '#fff' : 'var(--text-2)',
            }}>
              {t === '' ? '全部' : TYPE_LABELS[t] ?? t}
            </button>
          ))}
        </div>
      </div>

      {/* Tool List */}
      {filtered.length === 0 ? (
        <div style={emptyState}>
          <Wrench size={40} strokeWidth={1.5} />
          <p style={{ fontWeight: 600, margin: '12px 0 4px', fontSize: 15 }}>暂无工具</p>
          <p style={{ fontSize: 13 }}>注册你的第一个工具</p>
          <button onClick={() => setShowCreate(true)} style={{ ...btn, marginTop: 12 }}><Plus size={14} /> 注册工具</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(tool => {
            const CatIcon = CATEGORY_ICONS[tool.category] || Wrench;
            const isExpanded = expandedTool === tool.id;
            const toolBindings = getToolBindings(tool.id);
            const permissions = JSON.parse(tool.permissions_json) as { requiresApproval: boolean; networkAccess: boolean; maxExecutionTime: number };

            return (
              <div key={tool.id} style={{ ...toolCard, opacity: tool.enabled ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }} onClick={() => setExpandedTool(isExpanded ? null : tool.id)}>
                  {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} /> : <ChevronRight size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
                  <div style={iconBadge(tool.category)}><CatIcon size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{tool.display_name}</span>
                      <code style={codeBadge}>{tool.name}</code>
                      <span style={typeBadge(tool.type)}>{TYPE_LABELS[tool.type] || tool.type}</span>
                      {tool.is_builtin ? <span style={builtinTag}>内置</span> : null}
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool.description}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {toolBindings.length > 0 && <span style={{ fontSize: 12, color: 'var(--text-3)', padding: '2px 8px', background: 'var(--bg-2)', borderRadius: 5 }}>{toolBindings.length} 绑定</span>}
                    <button onClick={e => { e.stopPropagation(); toggleTool(tool.id, !tool.enabled); }} style={{ ...actionBtn, color: tool.enabled ? 'var(--green)' : 'var(--text-3)' }}>
                      {tool.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                    {!tool.is_builtin && (
                      <>
                        <button onClick={e => { e.stopPropagation(); setEditTool(tool); setShowCreate(true); }} style={actionBtn}><Pencil size={14} /></button>
                        <button onClick={e => { e.stopPropagation(); if (confirm('确认删除？')) deleteTool(tool.id); }} style={{ ...actionBtn, color: 'var(--red)' }}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
                      <div>
                        <h4 style={sectTitle}>配置</h4>
                        <pre style={preStyle}>{tool.config_json}</pre>
                      </div>
                      <div>
                        <h4 style={sectTitle}>权限</h4>
                        <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={permRow}><span>需要审批</span><span style={{ fontWeight: 600 }}>{permissions.requiresApproval ? '是' : '否'}</span></div>
                          <div style={permRow}><span>网络访问</span><span style={{ fontWeight: 600 }}>{permissions.networkAccess ? '允许' : '禁止'}</span></div>
                          <div style={permRow}><span>超时</span><span style={{ fontWeight: 600 }}>{permissions.maxExecutionTime / 1000}s</span></div>
                        </div>
                      </div>
                    </div>
                    {tool.input_schema_json && (
                      <div style={{ marginTop: 14 }}>
                        <h4 style={sectTitle}>参数定义</h4>
                        <pre style={preStyle}>{JSON.stringify(JSON.parse(tool.input_schema_json), null, 2)}</pre>
                      </div>
                    )}
                    <div style={{ marginTop: 14 }}>
                      <h4 style={sectTitle}>绑定关系</h4>
                      <BindingManager toolId={tool.id} bindings={toolBindings} agents={agents} projects={projects} onSet={setBinding} onRemove={removeBinding} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <ToolFormModal tool={editTool} onClose={() => { setShowCreate(false); setEditTool(null); }} onCreate={createTool} onUpdate={updateTool} />
      )}
    </div>
  );
}

/* ── Binding Manager ── */
function BindingManager({ toolId, bindings, agents, projects, onSet, onRemove }: {
  toolId: string; bindings: ToolBindingData[];
  agents: { id: string; name: string }[]; projects: { id: string; name: string }[];
  onSet: (toolId: string, scope: string, targetId?: string) => void;
  onRemove: (toolId: string, scope: string, targetId?: string) => void;
}) {
  const [addScope, setAddScope] = useState('global');
  const [addTargetId, setAddTargetId] = useState('');

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {bindings.map(b => (
          <div key={b.id} style={bindChip(b.scope)}>
            {b.scope === 'global' ? '全局' : b.scope === 'project' ? '项目' : 'Agent'}
            {b.target_id && <span>: {b.scope === 'agent' ? (agents.find(a => a.id === b.target_id)?.name || b.target_id) : (projects.find(p => p.id === b.target_id)?.name || b.target_id)}</span>}
            <button onClick={() => onRemove(toolId, b.scope, b.target_id ?? undefined)} style={{ ...cardIconBtn, padding: 1, marginLeft: 2 }}><Unlink size={11} /></button>
          </div>
        ))}
        {bindings.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无绑定</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <select value={addScope} onChange={e => { setAddScope(e.target.value); setAddTargetId(''); }} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}>
          <option value="global">全局</option><option value="project">项目</option><option value="agent">Agent</option>
        </select>
        {addScope === 'agent' && <select value={addTargetId} onChange={e => setAddTargetId(e.target.value)} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}><option value="">选择 Agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>}
        {addScope === 'project' && <select value={addTargetId} onChange={e => setAddTargetId(e.target.value)} style={{ ...fInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}><option value="">选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <button onClick={() => { if (addScope !== 'global' && !addTargetId) return; onSet(toolId, addScope, addScope === 'global' ? undefined : addTargetId); setAddTargetId(''); }} style={{ ...btn, padding: '5px 12px', fontSize: 12 }}><Link size={12} /> 绑定</button>
      </div>
    </div>
  );
}

/* ── Form Modal ── */
function ToolFormModal({ tool, onClose, onCreate, onUpdate }: {
  tool: ToolData | null; onClose: () => void;
  onCreate: (p: { name: string; displayName: string; description: string; category: string; toolType: string; config: object; inputSchema?: object; defaultScope?: string }) => void;
  onUpdate: (id: string, fields: Record<string, unknown>) => void;
}) {
  const isEdit = !!tool;
  const [name, setName] = useState(tool?.name ?? '');
  const [displayName, setDisplayName] = useState(tool?.display_name ?? '');
  const [description, setDescription] = useState(tool?.description ?? '');
  const [category, setCategory] = useState(tool?.category ?? 'custom');
  const [toolType, setToolType] = useState(tool?.type ?? 'mcp');
  const [configStr, setConfigStr] = useState(tool?.config_json ?? '{\n  "command": "",\n  "args": [],\n  "transport": "stdio"\n}');
  const [schemaStr, setSchemaStr] = useState(tool?.input_schema_json ?? '');

  const handleSubmit = () => {
    let config: object;
    try { config = JSON.parse(configStr); } catch { alert('配置 JSON 格式错误'); return; }
    let inputSchema: object | undefined;
    if (schemaStr.trim()) {
      try { inputSchema = JSON.parse(schemaStr); } catch { alert('参数定义 JSON 格式错误'); return; }
    }
    if (isEdit && tool) onUpdate(tool.id, { displayName, description, category, toolType, config, inputSchema });
    else onCreate({ name, displayName, description, category, toolType, config, inputSchema, defaultScope: 'global' });
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? '编辑工具' : '注册新工具'}</h2>

        <div style={fGrid}>
          <label style={fLabel}>标识名<input value={name} onChange={e => setName(e.target.value)} style={fInput} placeholder="my_browser_tool" disabled={isEdit} /></label>
          <label style={fLabel}>显示名称<input value={displayName} onChange={e => setDisplayName(e.target.value)} style={fInput} placeholder="浏览器工具" /></label>
        </div>
        <label style={{ ...fLabel, marginTop: 12 }}>描述<textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...fInput, minHeight: 60 }} /></label>
        <div style={fGrid}>
          <label style={fLabel}>分类
            <select value={category} onChange={e => setCategory(e.target.value)} style={fInput}>
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={fLabel}>类型
            <select value={toolType} onChange={e => setToolType(e.target.value)} style={fInput}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label style={{ ...fLabel, marginTop: 12 }}>
          配置 (JSON)
          <textarea value={configStr} onChange={e => setConfigStr(e.target.value)} style={{ ...fInput, minHeight: 100, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }} />
        </label>
        {toolType === 'mcp' && (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4, padding: '8px 10px', background: 'var(--bg-2)', borderRadius: 8, fontFamily: 'monospace' }}>
            示例: {'{ "command": "npx", "args": ["@playwright/mcp@latest"], "transport": "stdio" }'}
          </div>
        )}
        <label style={{ ...fLabel, marginTop: 12 }}>参数定义 (JSON Schema, 可选)<textarea value={schemaStr} onChange={e => setSchemaStr(e.target.value)} style={{ ...fInput, minHeight: 80, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }} placeholder='{ "type": "object", "properties": { ... } }' /></label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} style={btnGhost}>取消</button>
          <button onClick={handleSubmit} style={btn}>{isEdit ? '保存修改' : '注册工具'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ── */
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--blue)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: 'var(--text-2)', border: '1px solid var(--border)' };
const actionBtn: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', padding: '5px 7px', color: 'var(--text-2)', display: 'flex' };
const cardIconBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 4, color: 'var(--text-3)', display: 'flex' };
const searchBox: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-1)', flex: 1, maxWidth: 360 };
const searchInput: React.CSSProperties = { border: 'none', background: 'none', outline: 'none', fontSize: 14, flex: 1, color: 'var(--text-1)' };
const clearBtn: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', padding: 2, borderRadius: 4 };
const filterBtn: React.CSSProperties = { padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer' };
const emptyState: React.CSSProperties = { textAlign: 'center', padding: '52px 24px', color: 'var(--text-3)', border: '2px dashed var(--border)', borderRadius: 12, background: 'var(--bg-2)' };
const toolCard: React.CSSProperties = { borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-1)', overflow: 'hidden', transition: 'box-shadow .2s' };
const iconBadge = (cat: string): React.CSSProperties => ({
  width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  background: cat === 'browser' ? '#dbeafe' : cat === 'network' ? '#fce7f3' : cat === 'automation' ? '#e0e7ff' : cat === 'filesystem' ? '#d1fae5' : '#f3f4f6',
  color: cat === 'browser' ? '#2563eb' : cat === 'network' ? '#db2777' : cat === 'automation' ? '#4f46e5' : cat === 'filesystem' ? '#059669' : '#6b7280',
});
const codeBadge: React.CSSProperties = { fontSize: 11, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-2)', color: 'var(--text-3)', fontFamily: 'monospace' };
const typeBadge = (type: string): React.CSSProperties => ({
  fontSize: 10, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
  background: type === 'mcp' ? '#ede9fe' : type === 'script' ? '#fffbeb' : '#ecfdf5',
  color: type === 'mcp' ? '#7c3aed' : type === 'script' ? '#d97706' : '#16a34a',
});
const builtinTag: React.CSSProperties = { fontSize: 10, padding: '2px 7px', borderRadius: 5, background: 'var(--bg-2)', color: 'var(--text-3)', fontWeight: 500 };
const sectTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-2)' };
const preStyle: React.CSSProperties = { fontSize: 12, fontFamily: 'monospace', background: 'var(--bg-2)', borderRadius: 8, padding: '10px 12px', margin: 0, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6, border: '1px solid var(--border)' };
const permRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12 };
const bindChip = (scope: string): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 5, fontSize: 11, fontWeight: 500,
  background: scope === 'global' ? '#dbeafe' : scope === 'project' ? '#d1fae5' : '#fce7f3',
  color: scope === 'global' ? '#2563eb' : scope === 'project' ? '#059669' : '#db2777',
});
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalBox: React.CSSProperties = { background: 'var(--bg-1)', borderRadius: 14, padding: '28px 28px 24px', width: 580, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.25)', border: '1px solid var(--border)' };
const fGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 };
const fLabel: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, fontWeight: 600, color: 'var(--text-2)' };
const fInput: React.CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, background: 'var(--bg-1)', color: 'var(--text-1)', outline: 'none', width: '100%', boxSizing: 'border-box' };
