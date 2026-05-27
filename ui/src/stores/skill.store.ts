import { create } from 'zustand'
import { wsRpc } from '../services/ws'

export interface SkillData {
  id: string
  name: string
  display_name: string
  description: string
  type: string
  content: string
  category: string
  enabled: number
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface SkillBindingData {
  id: string
  skill_id: string
  scope: string
  target_id: string | null
  enabled: number
  created_at: string
}

interface SkillStore {
  skills: SkillData[]
  bindings: SkillBindingData[]
  loading: boolean
  fetchSkills: () => void
  createSkill: (p: { name: string; displayName: string; description?: string; skillType?: string; content: string; category?: string; defaultScope?: string }) => Promise<void>
  updateSkill: (id: string, fields: Record<string, unknown>) => Promise<void>
  toggleSkill: (id: string, enabled: boolean) => void
  deleteSkill: (id: string) => void
  setBinding: (skillId: string, scope: string, targetId?: string) => void
  removeBinding: (skillId: string, scope: string, targetId?: string) => void
}

export const useSkillStore = create<SkillStore>((set, get) => ({
  skills: [],
  bindings: [],
  loading: false,

  fetchSkills: async () => {
    set({ loading: true })
    try {
      const data = await wsRpc('skills.list') as { skills: SkillData[]; bindings: SkillBindingData[] }
      set({ skills: data.skills, bindings: data.bindings, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createSkill: async (p) => {
    await wsRpc('skills.create', p)
    get().fetchSkills()
  },

  updateSkill: async (id, fields) => {
    await wsRpc('skills.update', { skillId: id, ...fields })
    get().fetchSkills()
  },

  toggleSkill: async (id, enabled) => {
    await wsRpc('skills.toggle', { skillId: id, enabled })
    get().fetchSkills()
  },

  deleteSkill: async (id) => {
    await wsRpc('skills.delete', { skillId: id })
    get().fetchSkills()
  },

  setBinding: async (skillId, scope, targetId) => {
    await wsRpc('skill-bindings.set', { skillId, scope, targetId })
    get().fetchSkills()
  },

  removeBinding: async (skillId, scope, targetId) => {
    await wsRpc('skill-bindings.remove', { skillId, scope, targetId })
    get().fetchSkills()
  },
}))
