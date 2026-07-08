import { create } from 'zustand'
import { wsClient } from '../services/ws-client'

export interface TemplateData {
  id: string
  name: string
  type: string
  runtime: string
  icon: string
  avatar_url: string | null
  system_prompt: string
  description: string | null
  skills_json: string | null
  is_builtin: number
  created_at: string
  updated_at: string
}

interface TemplateStore {
  templates: TemplateData[]
  loading: boolean
  fetchTemplates: () => Promise<void>
  createTemplate: (input: CreateTemplateInput) => Promise<TemplateData>
  updateTemplate: (id: string, input: Partial<CreateTemplateInput>) => Promise<TemplateData | null>
  deleteTemplate: (id: string) => Promise<void>
  getSkills: (tpl: TemplateData) => string[]
}

export interface CreateTemplateInput {
  name: string
  agentType: string
  runtime?: string
  icon?: string
  avatarUrl?: string | null
  systemPrompt?: string
  description?: string
  skills?: string[]
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    try {
      const data = (await wsClient.request({ type: 'templates.list' })) as TemplateData[]
      set({ templates: data, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createTemplate: async (input) => {
    const tpl = (await wsClient.request({ type: 'templates.create', ...input })) as TemplateData
    set({ templates: [...get().templates, tpl] })
    return tpl
  },

  updateTemplate: async (id, input) => {
    const tpl = (await wsClient.request({ type: 'templates.update', templateId: id, ...input })) as TemplateData | null
    if (tpl) {
      set({ templates: get().templates.map((t) => (t.id === id ? tpl : t)) })
    }
    return tpl
  },

  deleteTemplate: async (id) => {
    await wsClient.request({ type: 'templates.delete', templateId: id })
    set({ templates: get().templates.filter((t) => t.id !== id) })
  },

  getSkills: (tpl) => {
    if (!tpl.skills_json) return []
    try {
      return JSON.parse(tpl.skills_json) as string[]
    } catch {
      return []
    }
  },
}))
