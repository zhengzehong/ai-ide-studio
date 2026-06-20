import type { KnowledgePageData } from '../../stores/knowledge-base.store'
import { parseJsonStringArray, parseTags } from './wiki-link'

export interface PageFormState {
  title: string
  section: string
  summary: string
  body: string
  tags: string
  srcFiles: string
}

export function formFromPage(page: KnowledgePageData | null | undefined): PageFormState {
  return {
    title: page?.title ?? '',
    section: page?.section ?? '',
    summary: page?.summary ?? '',
    body: page?.body ?? '',
    tags: parseJsonStringArray(page?.tags_json).join(', '),
    srcFiles: parseJsonStringArray(page?.src_files_json).join('\n'),
  }
}

export function formTags(form: PageFormState): string[] {
  return parseTags(form.tags)
}

export function formSrcFiles(form: PageFormState): string[] {
  return form.srcFiles
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}
