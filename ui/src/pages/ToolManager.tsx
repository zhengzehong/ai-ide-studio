import { useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Code2,
  Database,
  Globe,
  Link,
  Network,
  Package,
  Pencil,
  Plus,
  Search,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlink,
  Wrench,
  X,
} from 'lucide-react'
import { AgentToolPermissionPanel } from '../components/tools/AgentToolPermissionPanel'
import { useAgentStore } from '../stores/agent.store'
import { useProjectStore } from '../stores/project.store'
import { useToolStore, type ToolBindingData, type ToolData } from '../stores/tool.store'

const CATEGORY_ICONS: Record<string, typeof Wrench> = {
  browser: Globe,
  filesystem: Terminal,
  network: Network,
  automation: Code2,
  code: Code2,
  data: Database,
  custom: Package,
}
const CATEGORY_LABELS: Record<string, string> = {
  browser: '浏览器',
  filesystem: '文件系统',
  network: '网络',
  automation: '自动化',
  code: '代码',
  data: '数据',
  custom: '自定义',
}
const TYPE_LABELS: Record<string, string> = { builtin: '内置', mcp: 'MCP 服务', script: '脚本' }

export default function ToolManager() {
  const {
    tools,
    bindings,
    profiles,
    fetchTools,
    fetchProfiles,
    createTool,
    updateTool,
    toggleTool,
    deleteTool,
    setBinding,
    removeBinding,
    applyProfile,
  } = useToolStore()
  const agents = useAgentStore((s) => s.agents)
  const projects = useProjectStore((s) => s.projects)
  const [searchQ, setSearchQ] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editTool, setEditTool] = useState<ToolData | null>(null)
  const [expandedTool, setExpandedTool] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState('')

  useEffect(() => {
    void fetchTools()
    void fetchProfiles()
  }, [fetchTools, fetchProfiles])

  const filtered = tools.filter((tool) => {
    const queryMatched =
      !searchQ ||
      tool.display_name.includes(searchQ) ||
      tool.name.includes(searchQ) ||
      tool.description.includes(searchQ)
    return queryMatched && (!filterType || tool.type === filterType)
  })
  const getToolBindings = (toolId: string): ToolBindingData[] =>
    bindings.filter((binding) => binding.tool_id === toolId)

  return (
    <div style={{ padding: '28px 36px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>工具管理</h1>
          <p style={{ color: 'var(--text-3)', fontSize: 14, margin: '6px 0 0' }}>
            注册、管理和绑定工具，支持 MCP 服务、脚本和内置平台方法。
          </p>
        </div>
        <button
          onClick={() => {
            setEditTool(null)
            setShowCreate(true)
          }}
          style={btn}
        >
          <Plus size={14} /> 注册工具
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        {[
          { label: '全部', count: tools.length, color: 'var(--text-1)' },
          { label: '内置', count: tools.filter((t) => t.is_builtin).length, color: '#16a34a' },
          { label: 'MCP', count: tools.filter((t) => t.type === 'mcp').length, color: '#7c3aed' },
          { label: '脚本', count: tools.filter((t) => t.type === 'script').length, color: '#d97706' },
        ].map((item) => (
          <div key={item.label} style={statPill}>
            <span style={{ fontWeight: 700, color: item.color }}>{item.count}</span>
            <span style={{ color: 'var(--text-3)' }}>{item.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <div style={searchBox}>
          <Search size={15} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <input
            value={searchQ}
            onChange={(event) => setSearchQ(event.target.value)}
            placeholder="搜索工具..."
            style={searchInput}
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} style={clearBtn}>
              <X size={14} />
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['', 'builtin', 'mcp', 'script'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              style={{
                ...filterBtn,
                background: filterType === type ? 'var(--blue)' : 'var(--bg-2)',
                color: filterType === type ? '#fff' : 'var(--text-2)',
              }}
            >
              {type === '' ? '全部' : TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </div>

      <AgentToolPermissionPanel
        agents={agents}
        tools={tools}
        bindings={bindings}
        profiles={profiles}
        selectedAgentId={selectedAgentId}
        onSelectAgent={setSelectedAgentId}
        onApplyProfile={applyProfile}
        onSetBinding={setBinding}
      />

      {filtered.length === 0 ? (
        <EmptyTools onCreate={() => setShowCreate(true)} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              bindings={getToolBindings(tool.id)}
              agents={agents}
              projects={projects}
              expanded={expandedTool === tool.id}
              onExpand={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
              onToggle={toggleTool}
              onEdit={() => {
                setEditTool(tool)
                setShowCreate(true)
              }}
              onDelete={deleteTool}
              onSetBinding={setBinding}
              onRemoveBinding={removeBinding}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <ToolFormModal
          tool={editTool}
          onClose={() => {
            setShowCreate(false)
            setEditTool(null)
          }}
          onCreate={createTool}
          onUpdate={updateTool}
        />
      )}
    </div>
  )
}

function EmptyTools({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={emptyState}>
      <Wrench size={40} strokeWidth={1.5} />
      <p style={{ fontWeight: 600, margin: '12px 0 4px', fontSize: 15 }}>暂无工具</p>
      <p style={{ fontSize: 13 }}>注册你的第一个工具</p>
      <button onClick={onCreate} style={{ ...btn, marginTop: 12 }}>
        <Plus size={14} /> 注册工具
      </button>
    </div>
  )
}

function ToolCard({
  tool,
  bindings,
  agents,
  projects,
  expanded,
  onExpand,
  onToggle,
  onEdit,
  onDelete,
  onSetBinding,
  onRemoveBinding,
}: {
  tool: ToolData
  bindings: ToolBindingData[]
  agents: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  expanded: boolean
  onExpand: () => void
  onToggle: (toolId: string, enabled: boolean) => Promise<void>
  onEdit: () => void
  onDelete: (toolId: string) => Promise<void>
  onSetBinding: (
    toolId: string,
    scope: string,
    targetId?: string,
    configOverride?: object,
    enabled?: boolean,
  ) => Promise<void>
  onRemoveBinding: (toolId: string, scope: string, targetId?: string) => Promise<void>
}) {
  const CatIcon = CATEGORY_ICONS[tool.category] || Wrench
  const permissions = parsePermissions(tool.permissions_json)
  return (
    <div style={{ ...toolCardStyle, opacity: tool.enabled ? 1 : 0.55 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
        onClick={onExpand}
      >
        {expanded ? (
          <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
        )}
        <div style={iconBadge(tool.category)}>
          <CatIcon size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{tool.display_name}</span>
            <code style={codeBadge}>{tool.name}</code>
            <span style={typeBadge(tool.type)}>{TYPE_LABELS[tool.type] || tool.type}</span>
            {tool.is_builtin ? <span style={builtinTag}>内置</span> : null}
          </div>
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 13,
              color: 'var(--text-3)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {tool.description}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {bindings.length > 0 && (
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-3)',
                padding: '2px 8px',
                background: 'var(--bg-2)',
                borderRadius: 5,
              }}
            >
              {bindings.length} 绑定
            </span>
          )}
          <button
            onClick={(event) => {
              event.stopPropagation()
              void onToggle(tool.id, !tool.enabled)
            }}
            style={{ ...actionBtn, color: tool.enabled ? 'var(--green)' : 'var(--text-3)' }}
          >
            {tool.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          {!tool.is_builtin && (
            <>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onEdit()
                }}
                style={actionBtn}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  if (confirm('确认删除？')) void onDelete(tool.id)
                }}
                style={{ ...actionBtn, color: 'var(--red)' }}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 18px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <InfoBlock title="配置" text={tool.config_json} />
            <div>
              <h4 style={sectTitle}>权限</h4>
              <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={permRow}>
                  <span>需要审批</span>
                  <span style={{ fontWeight: 600 }}>{permissions.requiresApproval ? '是' : '否'}</span>
                </div>
                <div style={permRow}>
                  <span>网络访问</span>
                  <span style={{ fontWeight: 600 }}>{permissions.networkAccess ? '允许' : '禁止'}</span>
                </div>
                <div style={permRow}>
                  <span>超时</span>
                  <span style={{ fontWeight: 600 }}>{permissions.maxExecutionTime / 1000}s</span>
                </div>
              </div>
            </div>
          </div>
          {tool.input_schema_json && <InfoBlock title="参数定义" text={formatJson(tool.input_schema_json)} />}
          <div style={{ marginTop: 14 }}>
            <h4 style={sectTitle}>绑定关系</h4>
            <BindingManager
              toolId={tool.id}
              bindings={bindings}
              agents={agents}
              projects={projects}
              onSet={onSetBinding}
              onRemove={onRemoveBinding}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function InfoBlock({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ marginTop: title === '配置' ? 0 : 14 }}>
      <h4 style={sectTitle}>{title}</h4>
      <pre style={preStyle}>{text}</pre>
    </div>
  )
}

function BindingManager({
  toolId,
  bindings,
  agents,
  projects,
  onSet,
  onRemove,
}: {
  toolId: string
  bindings: ToolBindingData[]
  agents: { id: string; name: string }[]
  projects: { id: string; name: string }[]
  onSet: (toolId: string, scope: string, targetId?: string, configOverride?: object, enabled?: boolean) => Promise<void>
  onRemove: (toolId: string, scope: string, targetId?: string) => Promise<void>
}) {
  const [addScope, setAddScope] = useState('global')
  const [addTargetId, setAddTargetId] = useState('')
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {bindings.map((binding) => (
          <div key={binding.id} style={bindChip(binding.scope, binding.enabled === 1)}>
            {binding.scope === 'global' ? '全局' : binding.scope === 'project' ? '项目' : 'Agent'}
            {binding.target_id && (
              <span>
                :{' '}
                {binding.scope === 'agent'
                  ? agents.find((a) => a.id === binding.target_id)?.name || binding.target_id
                  : projects.find((p) => p.id === binding.target_id)?.name || binding.target_id}
              </span>
            )}
            {binding.enabled === 0 && <span>（隐藏）</span>}
            <button
              onClick={() => {
                void onRemove(toolId, binding.scope, binding.target_id ?? undefined)
              }}
              style={{ ...cardIconBtn, padding: 1, marginLeft: 2 }}
            >
              <Unlink size={11} />
            </button>
          </div>
        ))}
        {bindings.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>暂无绑定</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={addScope}
          onChange={(event) => {
            setAddScope(event.target.value)
            setAddTargetId('')
          }}
          style={{ ...formInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}
        >
          <option value="global">全局</option>
          <option value="project">项目</option>
          <option value="agent">Agent</option>
        </select>
        {addScope === 'agent' && (
          <select
            value={addTargetId}
            onChange={(event) => setAddTargetId(event.target.value)}
            style={{ ...formInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}
          >
            <option value="">选择 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        )}
        {addScope === 'project' && (
          <select
            value={addTargetId}
            onChange={(event) => setAddTargetId(event.target.value)}
            style={{ ...formInput, width: 'auto', padding: '5px 10px', fontSize: 12 }}
          >
            <option value="">选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={() => {
            if (addScope !== 'global' && !addTargetId) return
            void onSet(toolId, addScope, addScope === 'global' ? undefined : addTargetId)
            setAddTargetId('')
          }}
          style={{ ...btn, padding: '5px 12px', fontSize: 12 }}
        >
          <Link size={12} /> 绑定
        </button>
      </div>
    </div>
  )
}

function ToolFormModal({
  tool,
  onClose,
  onCreate,
  onUpdate,
}: {
  tool: ToolData | null
  onClose: () => void
  onCreate: (input: {
    name: string
    displayName: string
    description: string
    category: string
    toolType: string
    config: object
    inputSchema?: object
    defaultScope?: string
  }) => Promise<void>
  onUpdate: (id: string, fields: Record<string, unknown>) => Promise<void>
}) {
  const isEdit = !!tool
  const [name, setName] = useState(tool?.name ?? '')
  const [displayName, setDisplayName] = useState(tool?.display_name ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [category, setCategory] = useState(tool?.category ?? 'custom')
  const [toolType, setToolType] = useState(tool?.type ?? 'mcp')
  const [configStr, setConfigStr] = useState(
    tool?.config_json ?? '{\n  "command": "",\n  "args": [],\n  "transport": "stdio"\n}',
  )
  const [schemaStr, setSchemaStr] = useState(tool?.input_schema_json ?? '')
  const handleSubmit = () => {
    const config = parseJsonObject(configStr, '配置 JSON 格式错误')
    if (!config) return
    const inputSchema = schemaStr.trim() ? parseJsonObject(schemaStr, '参数定义 JSON 格式错误') : undefined
    if (schemaStr.trim() && !inputSchema) return
    if (isEdit && tool) void onUpdate(tool.id, { displayName, description, category, toolType, config, inputSchema })
    else
      void onCreate({ name, displayName, description, category, toolType, config, inputSchema, defaultScope: 'global' })
    onClose()
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={modalBox} onClick={(event) => event.stopPropagation()}>
        <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>{isEdit ? '编辑工具' : '注册新工具'}</h2>
        <div style={formGrid}>
          <label style={formLabel}>
            标识名
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              style={formInput}
              placeholder="my_browser_tool"
              disabled={isEdit}
            />
          </label>
          <label style={formLabel}>
            显示名称
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              style={formInput}
              placeholder="浏览器工具"
            />
          </label>
        </div>
        <label style={{ ...formLabel, marginTop: 12 }}>
          描述
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            style={{ ...formInput, minHeight: 60 }}
          />
        </label>
        <div style={formGrid}>
          <label style={formLabel}>
            分类
            <select value={category} onChange={(event) => setCategory(event.target.value)} style={formInput}>
              {Object.entries(CATEGORY_LABELS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label style={formLabel}>
            类型
            <select value={toolType} onChange={(event) => setToolType(event.target.value)} style={formInput}>
              {Object.entries(TYPE_LABELS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label style={{ ...formLabel, marginTop: 12 }}>
          配置 JSON
          <textarea
            value={configStr}
            onChange={(event) => setConfigStr(event.target.value)}
            style={{ ...formInput, minHeight: 100, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}
          />
        </label>
        {toolType === 'mcp' && (
          <div style={hintBox}>
            示例：{'{ "command": "npx", "args": ["@playwright/mcp@latest"], "transport": "stdio" }'}
          </div>
        )}
        <label style={{ ...formLabel, marginTop: 12 }}>
          参数定义 JSON Schema（可选）
          <textarea
            value={schemaStr}
            onChange={(event) => setSchemaStr(event.target.value)}
            style={{ ...formInput, minHeight: 80, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}
            placeholder='{ "type": "object", "properties": { } }'
          />
        </label>
        <div style={modalActions}>
          <button onClick={onClose} style={btnGhost}>
            取消
          </button>
          <button onClick={handleSubmit} style={btn}>
            {isEdit ? '保存修改' : '注册工具'}
          </button>
        </div>
      </div>
    </div>
  )
}

function parseJsonObject(value: string, error: string): object | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    alert(error)
    return undefined
  }
}
function formatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2)
  } catch {
    return value
  }
}
function parsePermissions(value: string): {
  requiresApproval: boolean
  networkAccess: boolean
  maxExecutionTime: number
} {
  try {
    return JSON.parse(value) as { requiresApproval: boolean; networkAccess: boolean; maxExecutionTime: number }
  } catch {
    return { requiresApproval: false, networkAccess: false, maxExecutionTime: 0 }
  }
}

const btn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 18px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--blue)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
}
const btnGhost: React.CSSProperties = {
  ...btn,
  background: 'transparent',
  color: 'var(--text-2)',
  border: '1px solid var(--border)',
}
const actionBtn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  cursor: 'pointer',
  padding: '5px 7px',
  color: 'var(--text-2)',
  display: 'flex',
}
const cardIconBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  borderRadius: 4,
  color: 'var(--text-3)',
  display: 'flex',
}
const statPill: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 8,
  background: 'var(--bg-2)',
  fontSize: 13,
}
const searchBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 14px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  flex: 1,
  maxWidth: 360,
}
const searchInput: React.CSSProperties = {
  border: 'none',
  background: 'none',
  outline: 'none',
  fontSize: 14,
  flex: 1,
  color: 'var(--text-1)',
}
const clearBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--text-3)',
  display: 'flex',
  padding: 2,
  borderRadius: 4,
}
const filterBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 8,
  border: 'none',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}
const emptyState: React.CSSProperties = {
  textAlign: 'center',
  padding: '52px 24px',
  color: 'var(--text-3)',
  border: '2px dashed var(--border)',
  borderRadius: 12,
  background: 'var(--bg-2)',
}
const toolCardStyle: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg-1)',
  overflow: 'hidden',
  transition: 'box-shadow .2s',
}
const iconBadge = (cat: string): React.CSSProperties => ({
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background:
    cat === 'browser'
      ? '#dbeafe'
      : cat === 'network'
        ? '#fce7f3'
        : cat === 'automation'
          ? '#e0e7ff'
          : cat === 'filesystem'
            ? '#d1fae5'
            : '#f3f4f6',
  color:
    cat === 'browser'
      ? '#2563eb'
      : cat === 'network'
        ? '#db2777'
        : cat === 'automation'
          ? '#4f46e5'
          : cat === 'filesystem'
            ? '#059669'
            : '#6b7280',
})
const codeBadge: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 7px',
  borderRadius: 5,
  background: 'var(--bg-2)',
  color: 'var(--text-3)',
  fontFamily: 'monospace',
}
const typeBadge = (type: string): React.CSSProperties => ({
  fontSize: 10,
  padding: '2px 7px',
  borderRadius: 5,
  fontWeight: 600,
  background: type === 'mcp' ? '#ede9fe' : type === 'script' ? '#fffbeb' : '#ecfdf5',
  color: type === 'mcp' ? '#7c3aed' : type === 'script' ? '#d97706' : '#16a34a',
})
const builtinTag: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 7px',
  borderRadius: 5,
  background: 'var(--bg-2)',
  color: 'var(--text-3)',
  fontWeight: 500,
}
const sectTitle: React.CSSProperties = { fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--text-2)' }
const preStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  background: 'var(--bg-2)',
  borderRadius: 8,
  padding: '10px 12px',
  margin: 0,
  overflow: 'auto',
  maxHeight: 200,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  lineHeight: 1.6,
  border: '1px solid var(--border)',
}
const permRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
}
const bindChip = (scope: string, enabled: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '3px 8px',
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  opacity: enabled ? 1 : 0.65,
  background: scope === 'global' ? '#dbeafe' : scope === 'project' ? '#d1fae5' : '#fce7f3',
  color: scope === 'global' ? '#2563eb' : scope === 'project' ? '#059669' : '#db2777',
})
const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
}
const modalBox: React.CSSProperties = {
  background: 'var(--bg-1)',
  borderRadius: 14,
  padding: '28px 28px 24px',
  width: 580,
  maxHeight: '85vh',
  overflow: 'auto',
  boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
  border: '1px solid var(--border)',
}
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }
const formLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-2)',
}
const formInput: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontSize: 13,
  background: 'var(--bg-1)',
  color: 'var(--text-1)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}
const hintBox: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-3)',
  marginTop: 4,
  padding: '8px 10px',
  background: 'var(--bg-2)',
  borderRadius: 8,
  fontFamily: 'monospace',
}
const modalActions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 20,
  paddingTop: 16,
  borderTop: '1px solid var(--border)',
}
