import type { ProjectData } from '../../stores/project.store'
import type { DashboardScope } from '../../pages/dashboard-view-model'

interface Props {
  scope: DashboardScope
  projects: ProjectData[]
  onChange: (scope: DashboardScope) => void
}

export function DashboardScopeSwitcher({ scope, projects, onChange }: Props) {
  const value = scope.type === 'all' ? 'all' : scope.projectId

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-2)' }}>
      <span>范围</span>
      <select
        value={value}
        onChange={(event) => {
          const next = event.target.value
          onChange(next === 'all' ? { type: 'all' } : { type: 'project', projectId: next })
        }}
        style={{
          minWidth: 160,
          padding: '8px 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'var(--bg-0)',
          color: 'var(--text-1)',
          fontSize: 14,
          outline: 'none',
        }}
      >
        <option value="all">全部项目</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </label>
  )
}
