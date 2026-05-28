import { Bot, Brain, Code, FileText, Search as SearchIcon, Server, Shield, TestTube } from 'lucide-react'

export const ICON_MAP: Record<string, typeof Brain> = {
  brain: Brain,
  code: Code,
  search: SearchIcon,
  'file-text': FileText,
  server: Server,
  'test-tube': TestTube,
  shield: Shield,
  bot: Bot,
}

export const TYPE_LABELS: Record<string, string> = {
  architect: '架构',
  dev: '开发',
  reviewer: '审查',
  tester: '测试',
  docs: '文档',
  ops: '运维',
}

export const TYPE_FILTERS = [
  { value: '', label: '全部' },
  { value: 'architect', label: '架构' },
  { value: 'dev', label: '开发' },
  { value: 'reviewer', label: '审查' },
  { value: 'tester', label: '测试' },
  { value: 'docs', label: '文档' },
  { value: 'ops', label: '运维' },
]

export const RUNTIME_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'mock', label: 'Mock' },
]

export const ICON_OPTIONS = Object.keys(ICON_MAP)
