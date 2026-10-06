import { captureComponentOperation, equalComponentValue, presentationComponentEdits } from '../../../../core/drivers/courseV10Operations'
import { frameCorners, translateFrame } from '../../../../core/components/geometry'
import { containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentEdit, type ComponentFrame, type ComponentInstance, type CourseProjectV10, type JsonObject } from '../../../../shared/contracts/component-platform'
import type { ContentApplyDiagnostic, ContentApplyPlan, ContentChangeRequest, ContentObjectDraft } from './types'

/** The outer frame remains the sole geometry owner. Internal Web CSS is handled by its component. */
export const cssStyleName = (name: string): string => name.startsWith('--') ? name : name.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)
export const isOuterGeometryStyle = (name: string): boolean => /^(?:position|inset(?:-.+)?|top|right|bottom|left|(?:min-|max-)?(?:width|height|inline-size|block-size)|margin(?:-.+)?|transform(?:-.+)?|translate|rotate|scale|zoom|z-index|float|clear|order|flex(?:-.+)?|grid(?:-.+)?|align-self|justify-self)$/i.test(cssStyleName(name))

export function contentTargetIds(project: CourseProjectV10, request: Pick<ContentChangeRequest, 'target'>): string[] {
  const roots = request.target.kind === 'instance' ? [request.target.instanceId] : containerChildIds(project, request.target.container)
  const visit = (id: string): string[] => {
    const instance = project.instances[id]
    if (!instance) throw new Error(`目标对象已不存在：${id}`)
    return [id, ...(instance.childIds ?? []).flatMap(visit)]
  }
  return roots.flatMap(visit)
}

function bounds(frame: ComponentFrame) {
  const corners = frameCorners(frame)
  return { left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)),
    top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)) }
}

/** Reading order owns the block position; a bounded local component keeps its intrinsic stage size. */
function flowBodyDraft(draft: ContentObjectDraft, definitions: Readonly<Record<string, ComponentDefinition>>): ContentObjectDraft {
  const implementation = draft.implementationOverride ?? definitions[draft.definitionId]?.implementation
  const bounded = implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
    || Boolean(draft.children?.length) || implementation?.kind === 'source'
  if (bounded && draft.frame) return { ...draft, frame: { width: draft.frame.width, height: draft.frame.height, transform: [1, 0, 0, 1, 0, 0] } }
  const { frame: _frame, ...flowDraft } = draft
  return flowDraft
}

/** Only new roots move. Lack of a vacant place is a local diagnostic, never a page rearrangement. */
function placeNewRoots(project: CourseProjectV10, container: ComponentContainer, drafts: ContentObjectDraft[], diagnostics: ContentApplyDiagnostic[], definitions: Readonly<Record<string, ComponentDefinition>>): ContentObjectDraft[] {
  const surface = container.kind === 'surface' ? project.surfaces.find(value => value.id === container.surfaceId) : undefined
  if (surface?.kind === 'flow') return drafts.map(draft => flowBodyDraft(draft, definitions))
  const size = surface?.designSize ?? (container.kind === 'instance' ? project.instances[container.instanceId]?.frame : undefined)
  const occupied = containerChildIds(project, container).flatMap(id => project.instances[id]?.frame ? [bounds(project.instances[id]!.frame!)] : [])
  return drafts.map(draft => {
    if (!draft.frame) return draft
    const proposed = bounds(draft.frame)
    const width = proposed.right - proposed.left, height = proposed.bottom - proposed.top
    const clear = (left: number, top: number) => (!size || left >= 0 && top >= 0 && left + width <= size.width && top + height <= size.height)
      && occupied.every(box => left + width <= box.left || left >= box.right || top + height <= box.top || top >= box.bottom)
    const xs = [...new Set([proposed.left, 0, ...occupied.map(box => box.right)])]
    const ys = [...new Set([proposed.top, 0, ...occupied.map(box => box.bottom)])]
    const candidates = xs.flatMap(left => ys.map(top => ({ left, top })))
      .sort((a, b) => Math.hypot(a.left - proposed.left, a.top - proposed.top) - Math.hypot(b.left - proposed.left, b.top - proposed.top))
    const position = candidates.find(candidate => clear(candidate.left, candidate.top))
    if (!position) diagnostics.push({ level: 'warning', code: 'insertion-overlap', message: '当前容器没有可用空位；新对象保留输入位置，原对象未移动。', repairable: true })
    const frame = position ? translateFrame(draft.frame, { x: position.left - proposed.left, y: position.top - proposed.top }) : draft.frame
    occupied.push(bounds(frame))
    return { ...draft, frame }
  })
}

export interface PlanContentApplyInput {
  project: CourseProjectV10
  request: ContentChangeRequest
  createId(): string
  /** Prepared HTML adapters and resource changes join the same canonical transaction. */
  drafts?: ContentObjectDraft[]
  edits?: ComponentEdit[]
  diagnostics?: ContentApplyDiagnostic[]
  unusable?: boolean
  unverified?: boolean
}

export function planContentApply(input: PlanContentApplyInput): ContentApplyPlan {
  const { project: baseProject, request } = input
  const context = request.editingContext
  const project = context ? resolveComponentPresentation(baseProject, context.surfaceId, context.stateId) : baseProject
  const diagnostics = [...input.diagnostics ?? []]
  const edits: ComponentEdit[] = [...input.edits ?? []]
  if (request.source.kind === 'objects' || request.source.kind === 'data') edits.push(...request.source.componentFiles ?? [])
  const insertedIds: string[] = []
  if (request.intent === 'insert' || request.intent === 'redo') {
    let container: ComponentContainer, index: number
    if (request.target.kind === 'instance') {
      const owner = owningContainer(project, request.target.instanceId)
      if (!owner) throw new Error('目标对象已失去归属')
      container = owner
      const position = containerChildIds(project, owner).indexOf(request.target.instanceId)
      index = request.intent === 'redo' ? position : position + 1
      if (request.intent === 'redo') edits.push({ type: 'instance.remove', instanceId: request.target.instanceId })
    } else {
      container = request.target.container
      const children = containerChildIds(project, container)
      index = request.intent === 'redo' ? 0 : request.target.index ?? children.length
      if (request.intent === 'redo') children.forEach(instanceId => edits.push({ type: 'instance.remove', instanceId }))
    }
    const drafts = input.drafts ?? (request.source.kind === 'objects' ? request.source.objects : undefined)
    if (!drafts?.length) throw new Error('插入或重做没有可应用对象')
    if (request.source.kind === 'objects') for (const definition of request.source.definitions ?? []) {
      const existing = project.definitions[definition.id]
      if (existing && !equalComponentValue(existing, definition)) throw new Error('新对象不能覆盖其他实例正在使用的定义')
      if (!existing) edits.push({ type: 'definition.set', definition })
    }
    const instances: ComponentInstance[] = []
    const allocate = (draft: ContentObjectDraft): string => {
      const id = input.createId()
      const children = draft.children?.map(allocate)
      const style = draft.style ? Object.fromEntries(Object.entries(draft.style).filter(([name]) => !isOuterGeometryStyle(name)).map(([name, value]) => [cssStyleName(name), value])) : undefined
      instances.push({ id, definitionId: draft.definitionId, data: structuredClone(draft.data),
        ...(style ? { style: structuredClone(style) } : {}), ...(draft.frame ? { frame: structuredClone(draft.frame) } : {}),
        ...(draft.implementationOverride ? { implementationOverride: structuredClone(draft.implementationOverride) } : {}),
        ...(children ? { childIds: children } : {}) })
      insertedIds.push(id)
      return id
    }
    const flow = container.kind === 'surface' && project.surfaces.find(surface => surface.id === container.surfaceId)?.kind === 'flow'
    const definitions = { ...project.definitions, ...(request.source.kind === 'objects'
      ? Object.fromEntries((request.source.definitions ?? []).map(definition => [definition.id, definition])) : {}) }
    for (const edit of edits) if (edit.type === 'definition.set') definitions[edit.definition.id] = edit.definition
    const placed = request.intent === 'insert' ? placeNewRoots(project, container, drafts, diagnostics, definitions)
      : flow ? drafts.map(draft => flowBodyDraft(draft, definitions)) : drafts
    edits.push({ type: 'instance.insert', container, index, instances, rootIds: placed.map(allocate) })
  } else if (request.intent === 'style') {
    if (request.source.kind !== 'style') throw new Error('样式意图需要明确的样式字段')
    const style: JsonObject = {}
    for (const [name, value] of Object.entries(request.source.style)) {
      if (isOuterGeometryStyle(name)) diagnostics.push({ level: 'info', code: 'frame-style-preserved', message: `外层 ${name} 由正式 frame 持有，样式修改未改变它。` })
      else if (value !== null && typeof value !== 'string' && typeof value !== 'number') diagnostics.push({ level: 'warning', code: 'unsupported-css-value', message: `${name} 不是当前 CSS consumer 支持的标量样式值，已保留其余样式。`, repairable: true })
      else style[cssStyleName(name)] = value
    }
    for (const instanceId of contentTargetIds(project, request)) for (const [name, value] of Object.entries(style)) {
      if (!equalComponentValue(project.instances[instanceId]?.style?.[name], value)) edits.push({ type: 'style.set', instanceId, path: [name], value })
    }
  } else if (request.source.kind === 'data') {
    if (request.target.kind !== 'instance') throw new Error('专业字段修改需要一个确定对象')
    const instanceId = request.target.instanceId
    if (!project.instances[instanceId]) throw new Error('目标对象已不存在')
    request.source.fields.forEach(field => edits.push({ type: 'data.set', instanceId, ...field }))
    if (request.source.implementation !== undefined) edits.push({ type: 'implementation.set', instanceId, implementation: request.source.implementation })
  } else if (request.source.kind !== 'html') throw new Error('内容意图需要局部 HTML 或专业字段')
  const mapped = context ? presentationComponentEdits(baseProject, context.surfaceId, context.stateId, edits) : edits
  return { command: captureComponentOperation(baseProject, mapped), diagnostics, input: request, insertedIds,
    usability: input.unusable ? 'unusable' : diagnostics.some(item => item.level !== 'info') ? 'partial' : input.unverified ? 'unverified' : 'usable' }
}
