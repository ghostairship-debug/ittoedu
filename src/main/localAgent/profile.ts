import type { LocalAgentId } from '../../shared/localAgentContract'
import { MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../shared/generationContract'
import { courseAgentSkills, courseAgentSkillMarkdown } from '../../shared/courseAgentSkills'

export function createGenerationProfile(adapter: LocalAgentId, request: GenerationRequest, resultChannel = 'structured-stdout') {
  if (resultChannel !== 'structured-stdout') throw new Error('当前 CLI profile 未开放此候选结果通道')
  const names = request.purpose === 'whole-course' ? ['course-build', 'visual-craft', 'interaction-craft']
    : ['course-design', 'pro-editing', 'qa-repair', 'style-remix', 'visual-craft', 'interaction-craft']
  return { version: 1, adapter, candidateVersion: 1, resultChannel,
    contextBudgetBytes: MAX_GENERATION_PROMPT_BYTES, skillRoots: [`candidates/${request.requestId}/skills`],
    capability: { immutableSnapshot: true, nativeAgentLoop: true, liveProjectTools: false, candidateFileIngestion: false },
    taskInstruction: '技能按任务语义选择：教学策划用 course-design；明确修改对象用 pro-editing；整课构建只消费已确认 Markdown。下面是本轮技能原文，已载入请求，无需额外读取文件。',
    skills: courseAgentSkills.filter(skill => names.includes(skill.name)).map(skill => ({ name: skill.name, markdown: courseAgentSkillMarkdown(skill) })),
  }
}
