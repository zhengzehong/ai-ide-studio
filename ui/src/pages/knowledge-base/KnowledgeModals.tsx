import { X } from 'lucide-react'
import type { AgentData } from '../../stores/agent.store'
import type { KnowledgeBaseSource } from '../../stores/knowledge-base.store'
import type { PageFormState } from './page-form'

export function CreateKnowledgeBaseModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: { name: string; kind: 'shared'; src: KnowledgeBaseSource; description?: string }) => void
}) {
  return (
    <ModalShell title="新建知识库" onClose={onClose}>
      <form
        className="kb-modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const name = String(form.get('name') || '').trim()
          if (!name) return
          onSubmit({
            name,
            kind: 'shared',
            src: String(form.get('src')) as KnowledgeBaseSource,
            description: String(form.get('description') || '').trim() || undefined,
          })
        }}
      >
        <input name="name" placeholder="知识库名称" required />
        <p className="kb-modal-help">当前项目库由系统自动维护，这里创建的是可挂载到多个项目的共享库。</p>
        <select name="src" defaultValue="manual">
          <option value="manual">手动沉淀</option>
          <option value="code">跟随代码</option>
        </select>
        <textarea name="description" rows={3} placeholder="描述" />
        <div className="kb-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="kb-primary-btn">创建</button>
        </div>
      </form>
    </ModalShell>
  )
}

export function CreatePageModal({
  initial,
  codeSource,
  onClose,
  onSubmit,
}: {
  initial: PageFormState
  codeSource: boolean
  onClose: () => void
  onSubmit: (form: PageFormState) => void
}) {
  return (
    <ModalShell title="新建页面" onClose={onClose}>
      <form
        className="kb-modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const next: PageFormState = {
            title: String(form.get('title') || '').trim(),
            section: String(form.get('section') || ''),
            summary: String(form.get('summary') || ''),
            body: String(form.get('body') || ''),
            tags: String(form.get('tags') || ''),
            srcFiles: String(form.get('srcFiles') || ''),
          }
          if (!next.title || !next.body) return
          onSubmit(next)
        }}
      >
        <input name="title" defaultValue={initial.title} placeholder="页面标题" required />
        <input name="section" defaultValue={initial.section} placeholder="分组" />
        <input name="summary" defaultValue={initial.summary} placeholder="摘要" />
        <input name="tags" defaultValue={initial.tags} placeholder="标签，用逗号分隔" />
        <textarea name="body" rows={10} defaultValue={initial.body} placeholder="Markdown 正文，支持 [[页面标题]]" required />
        {codeSource && <textarea name="srcFiles" rows={4} defaultValue={initial.srcFiles} placeholder="源文件路径，每行一个" />}
        <div className="kb-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="kb-primary-btn">创建</button>
        </div>
      </form>
    </ModalShell>
  )
}

export function RefreshAgentModal({
  agents,
  onClose,
  onSubmit,
}: {
  agents: AgentData[]
  onClose: () => void
  onSubmit: (agentId: string) => void
}) {
  return (
    <ModalShell title="让 AI 刷新代码页" onClose={onClose}>
      <form
        className="kb-modal-form"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          const agentId = String(form.get('agentId') || '')
          if (agentId) onSubmit(agentId)
        }}
      >
        <select name="agentId" required>
          <option value="">选择执行刷新任务的 Agent</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.runtime}</option>)}
        </select>
        <p className="kb-modal-help">系统会新建一条会话并发送指令，让 Agent 读取源文件后调用 core.kb.refresh_from_code。</p>
        <div className="kb-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="kb-primary-btn">开始</button>
        </div>
      </form>
    </ModalShell>
  )
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="kb-modal-backdrop" onClick={onClose} />
      <div className="kb-modal">
        <div className="kb-modal-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </>
  )
}
