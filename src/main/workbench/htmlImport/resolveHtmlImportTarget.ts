import type { CourseProjectDocument, FlowBlock } from '../../../shared/courseProjectTypes'
import { createHash } from 'node:crypto'

export type HtmlImportResolvedTarget =
  | { kind: 'slide'; locationId: string; surfaceId: string; sceneId: string }
  | { kind: 'flow'; locationId: string; surfaceId: string; anchorBlockId: string; createEmptyParagraph: boolean }

function hasBlock(blocks: readonly FlowBlock[], id: string): boolean {
  return blocks.some(block => block.id === id || block.type === 'section' && hasBlock(block.blocks, id))
}

export function resolveHtmlImportTarget(project: CourseProjectDocument, locationId: string, anchorBlockId?: string): HtmlImportResolvedTarget {
  const location = project.locations.find(item => item.id === locationId)
  const surface = project.surfaces.find(item => item.id === location?.surfaceId)
  if (!location || !surface) throw new Error('HTML 导入目标位置不存在')
  if (location.kind === 'slide-scene' && surface.type === 'slide') {
    if (anchorBlockId !== undefined) throw new Error('Slide 场景不接受 Flow 段落锚点')
    if (!surface.scenes.some(scene => scene.id === location.sceneId)) throw new Error('HTML 导入目标 Slide 场景不存在')
    return { kind: 'slide', locationId, surfaceId: surface.id, sceneId: location.sceneId }
  }
  if (location.kind === 'flow-block' && surface.type === 'flow') {
    if (anchorBlockId !== undefined) {
      if (!hasBlock(surface.blocks, anchorBlockId)) throw new Error('HTML 导入的 Flow 挂靠段落不存在')
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId, createEmptyParagraph: false }
    }
    const headingIndex = surface.blocks.findIndex(block => block.id === location.blockId)
    if (headingIndex < 0) throw new Error('HTML 导入的 Flow 位置锚点不存在')
    const body = surface.blocks.slice(headingIndex + 1).find(block => block.type === 'heading' ? true : block.type === 'paragraph')
    if (body?.type === 'paragraph')
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: body.id, createEmptyParagraph: false }
    const blockId = `html-import-paragraph-${createHash('sha256').update(`${surface.id}:${location.id}`).digest('hex').slice(0, 20)}`
    if (hasBlock(surface.blocks, blockId))
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: blockId, createEmptyParagraph: false }
    return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: blockId, createEmptyParagraph: true }
  }
  throw new Error('HTML 页面只能导入 Slide 场景或 Flow 正文')
}
