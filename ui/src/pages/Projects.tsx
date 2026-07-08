import { useMemo, useState, type CSSProperties } from 'react'
import { Plus, Search } from 'lucide-react'
import { useProjectStore, type ProjectData } from '../stores/project.store'
import { usePinnedProjects } from '../utils/project-meta'
import { ProjectCard } from '../components/project/ProjectCard'
import { ProjectFormModal, type ProjectFormValue } from '../components/project/ProjectFormModal'
import { DeleteConfirmModal } from '../components/project/DeleteConfirmModal'

type FilterKey = 'all' | 'current' | 'pinned' | 'recent'

export default function Projects() {
  const projects = useProjectStore((s) => s.projects)
  const currentProjectId = useProjectStore((s) => s.currentProjectId)
  const createProject = useProjectStore((s) => s.createProject)
  const updateProject = useProjectStore((s) => s.updateProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const { pinnedIds } = usePinnedProjects()

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingProject, setEditingProject] = useState<ProjectData | null>(null)
  const [deletingProject, setDeletingProject] = useState<ProjectData | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = projects
    if (q) {
      list = list.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.work_dir.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
      )
    }
    if (filter === 'current') {
      list = list.filter((p) => p.id === currentProjectId)
    } else if (filter === 'pinned') {
      list = list.filter((p) => pinnedIds.includes(p.id))
    } else if (filter === 'recent') {
      list = [...list]
        .sort((a, b) => {
          const at = a.last_visited_at ? Date.parse(a.last_visited_at) : 0
          const bt = b.last_visited_at ? Date.parse(b.last_visited_at) : 0
          return bt - at
        })
        .slice(0, 5)
    }
    return list
  }, [projects, query, filter, currentProjectId, pinnedIds])

  const counts = useMemo(() => ({
    all: projects.length,
    current: currentProjectId ? 1 : 0,
    pinned: pinnedIds.length,
    recent: Math.min(5, projects.filter((p) => p.last_visited_at).length),
  }), [projects, currentProjectId, pinnedIds])

  const openCreate = () => {
    setFormMode('create')
    setEditingProject(null)
    setFormOpen(true)
  }

  const openEdit = (p: ProjectData) => {
    setFormMode('edit')
    setEditingProject(p)
    setFormOpen(true)
  }

  const handleSubmit = async (value: ProjectFormValue) => {
    if (formMode === 'create') {
      await createProject({
        name: value.name,
        workDir: value.workDir,
        description: value.description || undefined,
        color: value.color || undefined,
        icon: value.icon || undefined,
      })
    } else if (editingProject) {
      await updateProject(editingProject.id, {
        name: value.name,
        workDir: value.workDir,
        description: value.description || undefined,
        color: value.color || undefined,
        icon: value.icon || undefined,
      })
    }
    setFormOpen(false)
    setEditingProject(null)
  }

  const handleDelete = async () => {
    if (!deletingProject) return
    await deleteProject(deletingProject.id)
    setDeletingProject(null)
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>项目管理</h1>
        <button type="button" onClick={openCreate} style={styles.btnPrimary}>
          <Plus size={14} /> 新建项目
        </button>
      </div>

      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称、路径、描述搜索..."
            style={styles.searchInput}
          />
        </div>
        <div style={styles.filters}>
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label={`全部 (${counts.all})`} />
          <FilterChip active={filter === 'current'} onClick={() => setFilter('current')} label={`当前 (${counts.current})`} />
          <FilterChip active={filter === 'pinned'} onClick={() => setFilter('pinned')} label={`已固定 (${counts.pinned})`} />
          <FilterChip active={filter === 'recent'} onClick={() => setFilter('recent')} label={`最近访问 (${counts.recent})`} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          {projects.length === 0 ? '还没有项目,点击右上角"新建项目"创建。' : '没有匹配的项目。'}
        </div>
      ) : (
        <div style={styles.grid}>
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isCurrent={p.id === currentProjectId}
              onEdit={openEdit}
              onDelete={setDeletingProject}
            />
          ))}
        </div>
      )}

      <ProjectFormModal
        key={formOpen ? `${formMode}:${editingProject?.id ?? 'new'}` : 'closed'}
        open={formOpen}
        mode={formMode}
        initial={editingProject}
        onClose={() => { setFormOpen(false); setEditingProject(null) }}
        onSubmit={handleSubmit}
      />

      <DeleteConfirmModal
        open={deletingProject !== null}
        project={deletingProject}
        onConfirm={handleDelete}
        onCancel={() => setDeletingProject(null)}
      />
    </div>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 10px',
        borderRadius: 14,
        background: active ? 'rgba(37, 99, 235, 0.1)' : 'var(--bg-1)',
        fontSize: 12,
        color: active ? 'var(--blue)' : 'var(--text-2)',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

const styles: Record<string, CSSProperties> = {
  page: {
    padding: '24px 32px',
    height: '100%',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  title: { fontSize: 22, fontWeight: 600, color: 'var(--text-1)', margin: 0 },
  btnPrimary: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '7px 14px',
    background: 'var(--blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  },
  toolbar: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  searchBox: {
    flex: 1,
    position: 'relative',
    maxWidth: 400,
    minWidth: 200,
  },
  searchInput: {
    width: '100%',
    padding: '7px 12px 7px 32px',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    outline: 'none',
    background: 'var(--bg-0)',
    color: 'var(--text-1)',
    boxSizing: 'border-box',
  },
  filters: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  empty: {
    padding: '40px 0',
    textAlign: 'center',
    color: 'var(--text-3)',
    fontSize: 14,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
    gap: 14,
  },
}
