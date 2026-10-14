import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'

export async function mountFlowToc(root: HTMLElement, hidden = false) {
  const project = createBlankCourseProjectV10('无教师台的讲义')
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  project.surfaces[0] = { id: 'flow', kind: 'flow', title: '流式讲义', childIds: ['intro', 'space', 'conclusion'],
    flow: { layout: { readingWidth: 760, wideContentWidth: 1100, ...(hidden ? { toc: 'hidden' as const } : {}) } } }
  for (const [id, title] of [['intro', '观察问题'], ['conclusion', '总结结论']]) project.instances[id] = {
    id, definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: title }] } },
  }
  project.instances.space = { id: 'space', definitionId: DOCUMENT_BLOCK_DEFINITION.id,
    data: { type: 'code', language: 'text', code: Array.from({ length: 60 }, (_, i) => `阅读内容 ${i + 1}`).join('\n') } }
  const { payload } = await buildPublishedCourseV3({ project, assetBytes: {} })
  const diagnostics: string[] = []
  const player = await mountPublishedCourseV3(payload, root, { report: text => diagnostics.push(text) })
  return { player, project, diagnostics }
}
