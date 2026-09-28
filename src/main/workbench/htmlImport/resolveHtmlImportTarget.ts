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
  if (surface.type === 'spatial-2d') throw new Error('HTML 页面不支持导入到 Spatial 空间表面')
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

import type { HtmlImportDestination } from '../../../shared/workbench/toolPorts'

export type HtmlImportMultiPageDestinationResolved =
  | { kind: 'slide-new'; surfaceId: string; after?: string }
  | { kind: 'slide'; locationId: string; surfaceId: string; sceneId: string }
  | { kind: 'flow'; locationId: string; surfaceId: string; anchorBlockId: string; createEmptyParagraph: boolean; containerPath?: number[]; insertAt?: number }

export function resolveHtmlImportDestination(
  project: CourseProjectDocument,
  destination: HtmlImportDestination,
  pageIndex: number,
  operationId: string,
): HtmlImportMultiPageDestinationResolved {
  if (destination.kind === 'slide-new') {
    const surface = project.surfaces.find(item => item.id === destination.surface)
    if (surface?.type === 'spatial-2d') throw new Error('HTML 页面不支持导入到 Spatial 空间表面')
    if (!surface || surface.type !== 'slide') throw new Error(`找不到用于新建页面的 Slide 表面：${destination.surface}`)
    if (destination.after && !surface.scenes.some(scene => scene.id === destination.after)
      && !project.locations.some(item => item.kind === 'slide-scene' && item.surfaceId === surface.id && item.id === destination.after))
      throw new Error('新页插入位置不属于目标 Slide 表面')
    const after = project.locations.find(item => item.kind === 'slide-scene' && item.surfaceId === surface.id && item.id === destination.after)
    return { kind: 'slide-new', surfaceId: surface.id, ...(destination.after ? { after: after?.kind === 'slide-scene' ? after.sceneId : destination.after } : {}) }
  }
  if (destination.kind === 'slide-existing') {
    const location = project.locations.find(item => item.id === destination.location)
    const surface = project.surfaces.find(item => item.id === location?.surfaceId)
    if (!location || !surface) throw new Error('HTML 导入目标位置不存在')
    if (surface.type === 'spatial-2d') throw new Error('HTML 页面不支持导入到 Spatial 空间表面')
    if (location.kind !== 'slide-scene' || surface.type !== 'slide') throw new Error('目标位置不是 Slide 场景')
    return { kind: 'slide', locationId: location.id, surfaceId: surface.id, sceneId: location.sceneId }
  }
  if (destination.kind === 'flow-insert') {
    let surface = project.surfaces.find(item => item.id === destination.container)
    let location = project.locations.find(item => item.id === destination.container)
    if (!surface && location) surface = project.surfaces.find(item => item.id === location!.surfaceId)
    if (!surface) {
      for (const s of project.surfaces) {
        if (s.type === 'flow' && findBlock(s.blocks, destination.container)) {
          surface = s
          break
        }
      }
    }
    if (!surface) throw new Error(`找不到 Flow 容器目标：${destination.container}`)
    if (surface.type === 'spatial-2d') throw new Error('HTML 页面不支持导入到 Spatial 空间表面')
    if (surface.type !== 'flow') throw new Error('目标不是 Flow 表面')
    const selected = location?.kind === 'flow-block' ? findBlock(surface.blocks, location.blockId)
      : findBlock(surface.blocks, destination.container)
    const flowLocation = location ?? project.locations.find(item => item.kind === 'flow-block' && item.surfaceId === surface!.id
      && item.blockId === selected?.block.id) ?? project.locations.find(item => item.kind === 'flow-block' && item.surfaceId === surface!.id)
    const locationId = flowLocation?.id ?? surface.id
    const blockId = `html-import-paragraph-${createHash('sha256').update(`${operationId}:${surface.id}:${destination.container}:${pageIndex}`).digest('hex').slice(0, 20)}`
    if (findBlock(surface.blocks, blockId)) throw new Error('HTML 导入 Flow 段落身份冲突')
    const containerPath = selected?.block.type === 'section' ? [...selected.containerPath, selected.index]
      : selected?.containerPath ?? []
    const blocks = selected?.block.type === 'section' ? selected.block.blocks : selected?.blocks ?? surface.blocks
    const nextBoundary = selected && selected.block.type !== 'section'
      ? blocks.findIndex((block, index) => index > selected.index && (block.type === 'heading' || block.type === 'section')) : -1
    const insertAt = selected?.block.type === 'section' ? selected.block.blocks.length
      : selected ? nextBoundary < 0 ? blocks.length : nextBoundary : surface.blocks.length
    return { kind: 'flow', locationId, surfaceId: surface.id, anchorBlockId: blockId,
      createEmptyParagraph: true, containerPath, insertAt }
  }
  throw new Error('不支持的 HTML 导入目标类型')
}
