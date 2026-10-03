import type { CourseProjectDocument, FlowBlock, FlowSurfaceDocument } from '../../shared/courseProjectTypes'
import type { DocumentResources } from '../../shared/workbench/document'
import { controllerTargetIdsForLocations, repairRemovedCourseReferences } from '../tools/courseReferenceCleanup'
import { commitCourseProjectMutation } from '../tools/courseProjectMutation'
import { addCourseFlowPage, deleteCourseSurface, renameCourseSurface } from '../tools/courseLocations'
import { flowSurfaceIn, listFlowCourseAnchors, syncFlowCourseLocations, walkFlowBlocks } from '../tools/flowDocumentModel'
import { alignFlowBlocks, FlowContentError, parseFlowHtml, serializeFlowHtml, type FlowHtmlContext } from './flowHtml'
import type { PageParsePort } from './pageHtml'
import { fileStem } from './projectFileView'
import { ProjectFileError, type PlannedChange } from './slidePages'

const DOC_PATH = /^docs\/([^/]+)\.html$/
const NATIVE_KIND: Record<string, string> = { text: '文字', formula: '公式', image: '图片', video: '视频', shape: '形状', table: '表格', chart: '图表', input: '输入框' }

export interface DocFile { path: string; surface: FlowSurfaceDocument }

/** One file per Flow surface, named by its title: `docs/讲义.html`; equal titles are numbered. */
export function docFiles(project: CourseProjectDocument): DocFile[] {
  const used = new Map<string, number>()
  return project.surfaces.filter((surface): surface is FlowSurfaceDocument => surface.type === 'flow').map(surface => {
    const stem = fileStem(surface.title), key = stem.normalize('NFC').toLowerCase()
    const count = (used.get(key) ?? 0) + 1
    used.set(key, count)
    return { path: `docs/${count > 1 ? `${stem} ${count}` : stem}.html`, surface }
  })
}

export function flowContext(project: CourseProjectDocument): FlowHtmlContext {
  return { assets: project.assets, packageName: packageId => project.componentPackages[packageId]?.name ?? packageId }
}

export function readDocFile(project: CourseProjectDocument, file: DocFile): { content: string; objects: string[] } {
  return { content: serializeFlowHtml(file.surface, flowContext(project)),
    objects: file.surface.surfaceLayerItems.map(({ item }) => {
      const kind = item.kind === 'native' ? NATIVE_KIND[item.content.nativeType] ?? '对象' : item.kind === 'component' ? '组件' : item.kind === 'runtime' ? '程序' : '组合内容'
      return item.label ? `${kind}“${item.label}”` : kind
    }) }
}

function docName(path: string): string {
  const name = DOC_PATH.exec(path)?.[1]
  if (name === undefined) throw new ProjectFileError('invalid-path', '讲义路径须为 docs/<名称>.html')
  if (fileStem(name) !== name) throw new ProjectFileError('invalid-path', '讲义名称不能含 \\ / : * ? " < > | # % 或控制字符，首尾不能是空格或点')
  return name
}

const blockIds = (blocks: readonly FlowBlock[]) => {
  const ids = new Set<string>()
  walkFlowBlocks(blocks, block => { ids.add(block.id) })
  return ids
}

/** The whole handout of one Flow surface; a new path creates the surface. Paragraph-anchored objects follow their blocks. */
export function planDocWrite(input: { project: CourseProjectDocument; resources: DocumentResources; path: string; html: string; parse: PageParsePort }): PlannedChange {
  let project = input.project
  let surfaceId = docFiles(project).find(file => file.path === input.path)?.surface.id
  if (!surfaceId) {
    const added = addCourseFlowPage(project, { title: docName(input.path) })
    if (!added.ok) throw new ProjectFileError('invalid-path', added.reason)
    project = added.project
    surfaceId = project.locations.find(location => location.id === added.activatedLocationId)!.surfaceId
  }
  const surface = flowSurfaceIn(project, surfaceId)
  let parsed: ReturnType<typeof parseFlowHtml>
  try { parsed = parseFlowHtml(input.html, { parse: input.parse, assets: project.assets }) }
  catch (error) { if (error instanceof FlowContentError) throw new ProjectFileError('unsupported-content', error.message); throw error }
  const { blocks, unresolved } = alignFlowBlocks(parsed.blocks, surface.blocks, flowContext(project))
  if (!listFlowCourseAnchors(blocks).length)
    throw new ProjectFileError('heading-required', '讲义至少需要一个标题（h1–h6）或分节（details/summary），作为导航位置')
  const kept = blockIds(blocks), id = surfaceId
  const removed = project.locations.filter(location => location.kind === 'flow-block' && location.surfaceId === id && !kept.has(location.blockId))
  let next: CourseProjectDocument
  try {
    next = commitCourseProjectMutation(project, draft => {
      flowSurfaceIn(draft, id).blocks = blocks
      syncFlowCourseLocations(draft, id)
      repairRemovedCourseReferences(draft, { removedLocationIds: new Set(removed.map(location => location.id)),
        removedControllerTargetIds: controllerTargetIdsForLocations(removed) })
    })
  } catch (error) { throw new ProjectFileError('invalid-content', `讲义内容无效：${error instanceof Error ? error.message : String(error)}`) }
  return { project: next, resources: input.resources, identity: `doc:${id}`,
    diagnostics: [...parsed.diagnostics, ...unresolved.map(name => ({ level: 'warning' as const, code: 'flow-component',
      message: `讲义中的组件“${name}”只能在编辑器中插入，已忽略` }))] }
}

export function planDocMove(project: CourseProjectDocument, resources: DocumentResources, from: string, to: string): PlannedChange {
  const file = docFiles(project).find(value => value.path === from)
  if (!file) throw new ProjectFileError('not-found', `没有这个讲义：${from}`)
  const name = docName(to)
  if (docFiles(project).some(value => value.path === to && value !== file)) throw new ProjectFileError('exists', `${to} 已存在`)
  try { return { project: renameCourseSurface(project, file.surface.id, name), resources, identity: `doc:${file.surface.id}`, diagnostics: [] } }
  catch (error) { throw new ProjectFileError('invalid-path', error instanceof Error ? error.message : String(error)) }
}

/** Deleting a handout deletes its Flow surface with the existing rules; the course keeps at least one location. */
export function planDocDelete(project: CourseProjectDocument, resources: DocumentResources, path: string): PlannedChange {
  const file = docFiles(project).find(value => value.path === path)
  if (!file) throw new ProjectFileError('not-found', `没有这个讲义：${path}`)
  const deleted = deleteCourseSurface(project, file.surface.id)
  if (!deleted.ok) throw new ProjectFileError('delete-refused', deleted.reason)
  return { project: deleted.project, resources, identity: `doc:${file.surface.id}`, diagnostics: [] }
}

export const isDocPath = (path: string) => DOC_PATH.test(path)
