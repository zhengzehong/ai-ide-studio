import { FolderOpen } from 'lucide-react'
import FilterSelectSheet from './FilterSelectSheet'

interface ProjectItem {
  id: string
  name: string
}

interface Props {
  projects: ProjectItem[]
  currentId: string | null
  onChange: (id: string | null) => void
}

export default function ProjectSwitcher({ projects, currentId, onChange }: Props) {
  return (
    <FilterSelectSheet
      icon={<FolderOpen size={16} color="var(--primary)" />}
      title="切换项目"
      value={currentId ?? ''}
      options={[
        { value: '', label: '全部项目' },
        ...projects.map((project) => ({ value: project.id, label: project.name })),
      ]}
      onChange={(value) => onChange(value || null)}
    />
  )
}
