import { skillBindingStore, skillStore } from '../../store/skills.js'
import type { RpcHandlerMap } from './types.js'

type SkillType = 'prompt' | 'file' | 'mcp'
type SkillScope = 'global' | 'project' | 'agent'

export const skillRpcHandlers: RpcHandlerMap = {
  'skills.list'(_msg, { sendResult }) {
    sendResult({ skills: skillStore.list(), bindings: skillBindingStore.list() })
  },

  'skills.get'(msg, { sendResult }) {
    const skill = skillStore.get(msg.skillId as string)
    if (!skill) throw new Error('技能不存在')
    sendResult({ skill, bindings: skillBindingStore.list(skill.id) })
  },

  'skills.create'(msg, { sendResult }) {
    const skill = skillStore.create({
      name: msg.name as string,
      displayName: msg.displayName as string,
      description: msg.description as string | undefined,
      type: msg.skillType as SkillType | undefined,
      content: msg.content as string,
      category: msg.category as string | undefined,
    })
    if (msg.defaultScope) {
      skillBindingStore.set(skill.id, msg.defaultScope as SkillScope, msg.targetId as string ?? null)
    }
    sendResult(skill)
  },

  'skills.update'(msg, { sendResult }) {
    const updatedSkill = skillStore.update(msg.skillId as string, {
      displayName: msg.displayName as string | undefined,
      description: msg.description as string | undefined,
      type: msg.skillType as SkillType | undefined,
      content: msg.content as string | undefined,
      category: msg.category as string | undefined,
    })
    if (!updatedSkill) throw new Error('技能不存在')
    sendResult(updatedSkill)
  },

  'skills.toggle'(msg, { sendResult }) {
    skillStore.toggle(msg.skillId as string, msg.enabled as boolean)
    sendResult({ ok: true })
  },

  'skills.delete'(msg, { sendResult }) {
    const targetSkill = skillStore.get(msg.skillId as string)
    if (!targetSkill) throw new Error('技能不存在')
    if (targetSkill.is_builtin) throw new Error('不能删除内置技能')
    skillStore.delete(msg.skillId as string)
    sendResult({ ok: true })
  },

  'skill-bindings.set'(msg, { sendResult }) {
    sendResult(skillBindingStore.set(
      msg.skillId as string,
      msg.scope as SkillScope,
      msg.targetId as string ?? null,
    ))
  },

  'skill-bindings.remove'(msg, { sendResult }) {
    skillBindingStore.remove(msg.skillId as string, msg.scope as string, msg.targetId as string ?? null)
    sendResult({ ok: true })
  },
}
