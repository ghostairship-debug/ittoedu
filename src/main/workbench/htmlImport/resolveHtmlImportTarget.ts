import type { CourseProjectDocument, FlowBlock, FlowSurfaceDocument } from '../../../shared/courseProjectTypes'
import { createHash } from 'node:crypto'

export type HtmlImportResolvedTarget =
  | { kind: 'slide'; locationId: string; surfaceId: string; sceneId: string }
  | { kind: 'flow'; locationId: string; surfaceId: string; anchorBlockId: string; createEmptyParagraph: boolean;
      containerPath?: number[]; insertAt?: number }

function findBlock(blocks: readonly FlowBlock[], id: string, containerPath: number[] = []): { block: FlowBlock; blocks: readonly FlowBlock[]; index: number; containerPath: number[] } | null {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!
    if (block.id === id) return { block, blocks, index, containerPath }
    if (block.type === 'section') {
      const nested = findBlock(block.blocks, id, [...containerPath, index])
      if (nested) return nested
    }
  }
  return null
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
      if (!findBlock(surface.blocks, anchorBlockId)) throw new Error('HTML 导入的 Flow 挂靠段落不存在')
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId, createEmptyParagraph: false }
    }
    const located = findBlock(surface.blocks, location.blockId)
    if (!located) throw new Error('HTML 导入的 Flow 位置锚点不存在')
    const bodyBlocks = located.block.type === 'section' ? located.block.blocks : located.blocks
    const bodyPath = located.block.type === 'section' ? [...located.containerPath, located.index] : located.containerPath
    const bodyStart = located.block.type === 'section' ? 0 : located.index + 1
    const body = bodyBlocks.slice(bodyStart).find(block => block.type === 'heading' || block.type === 'section' || block.type === 'paragraph')
    if (body?.type === 'paragraph')
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: body.id, createEmptyParagraph: false }
    const blockId = `html-import-paragraph-${createHash('sha256').update(`${surface.id}:${location.id}`).digest('hex').slice(0, 20)}`
    if (findBlock(surface.blocks, blockId))
      return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: blockId, createEmptyParagraph: false }
    return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: blockId, createEmptyParagraph: true,
      containerPath: bodyPath, insertAt: bodyStart }
  }
  throw new Error('HTML 页面只能导入 Slide 场景或 Flow 正文')
}

export function insertHtmlImportEmptyParagraph(surface: FlowSurfaceDocument, target: Extract<HtmlImportResolvedTarget, { kind: 'flow' }>): void {
  if (!target.createEmptyParagraph) return
  if (!target.containerPath || target.insertAt === undefined) throw new Error('HTML 导入缺少空段落插入位置')
  let blocks = surface.blocks
  for (const index of target.containerPath) {
    const section = blocks[index]
    if (section?.type !== 'section') throw new Error('HTML 导入的 Flow 容器已改变')
    blocks = section.blocks
  }
  blocks.splice(target.insertAt, 0, { id: target.anchorBlockId, type: 'paragraph', content: { inlines: [] } })
}
