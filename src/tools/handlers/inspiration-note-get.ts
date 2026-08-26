import { getInspirationNoteForSession } from '../../core/project-inspiration-discussion.js'
import type { ToolContext, ToolHandler, ToolHandlerInput, ToolHandlerResult } from '../types.js'

export const inspirationNoteGetHandler: ToolHandler = {
  name: 'inspiration.note.get',
  description: '读取当前项目的一条灵感原文、最新整理结果和候选任务。仅灵感会话可用。',
  inputSchema: {
    type: 'object',
    properties: { noteId: { type: 'string', description: '灵感 ID' } },
    required: ['noteId'],
  },
  async execute(input: ToolHandlerInput, context: ToolContext): Promise<ToolHandlerResult> {
    try {
      const noteId = input.noteId
      if (typeof noteId !== 'string' || !noteId.trim()) throw new Error('noteId 不能为空')
      const note = getInspirationNoteForSession(context, noteId.trim())
      return { content: [{ type: 'text', text: JSON.stringify({ kind: 'inspiration-note', note }) }] }
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      }
    }
  },
}
