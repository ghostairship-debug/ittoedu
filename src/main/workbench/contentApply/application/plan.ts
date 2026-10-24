import { isNativeFlowLayoutGroup, isNativeFlowContainerStyle, isNativeFlowItemStyle, componentFlowStylePolicy, isFlowStickyStyle } from '../../../../shared/flowNativeLayout'
import { componentSurface } from '../../../../shared/contracts/component-platform/project'
import { captureComponentOperation, presentationComponentEdits } from '../../../../core/drivers/courseV10Operations'
import { equalComponentValue } from '../../../../shared/componentValue'
import { componentDataEdits } from '../../../../core/course/componentDataEdits'
import { frameCorners, multiplyMatrices, translateFrame } from '../../../../core/components/geometry'
import { contentPlacementRegion } from '../../../../core/contentApply/planning/placement'
import { containerChildIds, owningContainer, resolveComponentPresentation, type ComponentContainer, type ComponentDefinition, type ComponentEdit, type ComponentFrame, type ComponentInstance, type CourseProjectV10, type JsonObject, type JsonValue } from '../../../../shared/contracts/component-platform'
import type { ContentApplyDiagnostic, ContentApplyPlan, ContentApplyPlanOptions, ContentChangeRequest, ContentObjectDraft } from './types'
import { applyComponentStylePatch, cssStyleName, isOuterGeometryStyle } from '../../../../shared/componentStylePatch'
import { GROUP_DEFINITION } from './professionalGraphics'
import { normalizeContentObjectSource } from '../../../../core/contentApply/planning/objectSource'
import { professionalElementDefaultSize, professionalElementKind } from '../../../../core/course/professionalElementDefaults'
export { cssStyleName, isOuterGeometryStyle } from '../../../../shared/componentStylePatch'

/** The outer frame remains the sole geometry owner. Internal Web CSS is handled by its component. */

export function contentTargetIds(project: CourseProjectV10, request: Pick<ContentChangeRequest, 'target'>): string[] {
  const roots = request.target.kind === 'instance' ? [request.target.instanceId] : containerChildIds(project, request.target.container)
  const visit = (id: string): string[] => {
    const instance = project.instances[id]
    if (!instance) throw new Error(`目标对象已不存在：${id}`)
    return [id, ...(instance.childIds ?? []).flatMap(visit)]
  }
  return roots.flatMap(visit)
}

export class NoContentTargetError extends Error {
  readonly code = 'no-content-target'
  constructor() {
    super('当前范围没有可修改的内容对象，输入已保留。请通过 project.list 读取目标页面的结构 JSON 路径，再用 project.apply({ path: 页面结构路径, intent: "insert", content: 原内容 }) 或 from: 原文件路径显式插入。')
  }
}

/** HTML content edits require an existing object, even when the projection is empty. */
export function htmlContentTargetIds(project: CourseProjectV10, request: Pick<ContentChangeRequest, 'target'>): string[] {
  const ids = contentTargetIds(project, request)
  if (!ids.length) throw new NoContentTargetError()
  return ids
}

function bounds(frame: ComponentFrame) {
  const corners = frameCorners(frame)
  return { left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)),
    top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)) }
}

const boxText = (box: ReturnType<typeof bounds>) => `(${box.left},${box.top})–(${box.right},${box.bottom})`
const intersects = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** Only the addressed container owns layout; an ordinary group keeps its local free frames. */
function layoutContainer(project: CourseProjectV10, container: ComponentContainer) {
  return container.kind === 'surface' ? componentSurface(project, container.surfaceId)
    : container.kind === 'instance' ? componentSurface(project, container.instanceId) : undefined
}

/** Explicit composition stays where authored, including intentional overlap. */
function placeInRegion(project: CourseProjectV10, container: ComponentContainer, drafts: ContentObjectDraft[], region: ComponentFrame,
  diagnostics: ContentApplyDiagnostic[], checkNeighbors: boolean): ContentObjectDraft[] {
  const surface = layoutContainer(project, container)
  const size = surface?.designSize ?? (container.kind === 'instance' ? project.instances[container.instanceId]?.frame : undefined)
  const occupied = checkNeighbors ? containerChildIds(project, container).flatMap(id => {
    const frame = project.instances[id]?.frame
    return frame ? [{ id, box: bounds(frame) }] : []
  }) : []
  diagnostics.push({ level: 'info', code: 'content-placement-region',
    message: `本次在局部视口 ${Math.ceil(region.width)}×${Math.ceil(region.height)} 准备，正式位置沿所选区域变换 [${region.transform.join(',')}]；采用后由对象 frame 持有，原对象未移动。` })
  return drafts.map(draft => {
    const local = draft.frame ?? { width: region.width, height: region.height, transform: [1, 0, 0, 1, 0, 0] as ComponentFrame['transform'] }
    const measured = bounds(local)
    if (measured.left < 0 || measured.top < 0 || measured.right > region.width || measured.bottom > region.height) diagnostics.push({
      level: 'warning', code: 'content-region-overflow', repairable: true,
      message: `内容实测边界 ${boxText(measured)} 超出所选局部视口 (0,0)–(${region.width},${region.height})；内容与源码已保留，可改源码或用 object.update 调整正式 frame。` })
    const frame = { ...local, transform: [...multiplyMatrices(region.transform, local.transform)] as ComponentFrame['transform'] }
    const placed = bounds(frame), neighbors = occupied.filter(value => intersects(placed, value.box))
    if (neighbors.length) diagnostics.push({ level: 'warning', code: 'insertion-overlap', repairable: true,
      message: `新内容边界 ${boxText(placed)} 与原对象 ${neighbors.map(value => `${value.id} ${boxText(value.box)}`).join('、')} 相交；已保留明确放置与原对象，可按构图保留重叠或修改正式 frame。` })
    if (size && (placed.left < 0 || placed.top < 0 || placed.right > size.width || placed.bottom > size.height)) diagnostics.push({
      level: 'warning', code: 'insertion-container-overflow', repairable: true,
      message: `新内容边界 ${boxText(placed)} 超出父容器 (0,0)–(${size.width},${size.height})；内容与原对象保留，可修改正式 frame 或源码。` })
    return { ...draft, frame }
  })
}

/** Reading order owns the block position; a bounded local component keeps its intrinsic stage size. */
function flowBodyDraft(draft: ContentObjectDraft, definitions: Readonly<Record<string, ComponentDefinition>>): ContentObjectDraft {
  const implementation = draft.implementationOverride ?? definitions[draft.definitionId]?.implementation
  const professional = implementation?.kind === 'builtin' ? professionalElementKind(implementation.key) : undefined
  if (professional === 'table' || professional === 'chart') {
    const frame = draft.frame ?? { ...professionalElementDefaultSize(professional), transform: [1, 0, 0, 1, 0, 0] as ComponentFrame['transform'] }
    return { ...draft, frame: { ...frame, transform: [1, 0, 0, 1, 0, 0] } }
  }
  const bounded = implementation?.kind === 'builtin' && ['guoling.web', 'guoling.html-program'].includes(implementation.key)
    || Boolean(draft.children?.length) || implementation?.kind === 'source'
  if (bounded && draft.frame) return { ...draft, frame: { width: draft.frame.width, height: draft.frame.height, transform: [1, 0, 0, 1, 0, 0] } }
  const { frame: _frame, ...flowDraft } = draft
  return flowDraft
}

/** Only new roots move. Lack of a vacant place is a local diagnostic, never a page rearrangement. */
function placeNewRoots(project: CourseProjectV10, container: ComponentContainer, drafts: ContentObjectDraft[], diagnostics: ContentApplyDiagnostic[], definitions: Readonly<Record<string, ComponentDefinition>>): ContentObjectDraft[] {
  const surface = layoutContainer(project, container)
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
    if (!position) diagnostics.push({ level: 'warning', code: 'insertion-overlap',
      message: `当前容器${size ? ` (0,0)–(${size.width},${size.height})` : ''}没有可用空位；新内容边界 ${boxText(proposed)} 保留输入位置，原对象未移动。可保留有意重叠，或用 object.update 调整正式 frame。`, repairable: true })
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
  /** Measured page siblings already share one layout; do not repel them from each other. */
  preserveLayout?: boolean
}

export function planContentApply(input: PlanContentApplyInput, options: ContentApplyPlanOptions = {}): ContentApplyPlan {
  const { project: baseProject } = input
  const request: ContentChangeRequest = input.request.source.kind === 'objects'
    ? { ...input.request, source: normalizeContentObjectSource(input.request.source) } : input.request
  const context = request.editingContext
  const project = context ? resolveComponentPresentation(baseProject, context.surfaceId, context.stateId) : baseProject
  if (request.intent === 'content' && request.source.kind === 'html') htmlContentTargetIds(project, request)
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
    } else {
      container = request.target.container
      const children = containerChildIds(project, container)
      index = request.intent === 'redo' ? 0 : request.target.index ?? children.length
      if (request.intent === 'redo') children.forEach(instanceId => edits.push({ type: 'instance.remove', instanceId }))
    }
    const drafts = input.drafts ?? (request.source.kind === 'objects' ? request.source.objects : undefined)
    if (!drafts || !drafts.length && !(request.target.kind === 'container' && layoutContainer(project, request.target.container)
      && (input.preserveLayout || edits.some(edit => edit.type === 'surface.background.set')))) throw new Error('插入或重做没有可应用对象')
    if (request.source.kind === 'objects') for (const definition of request.source.definitions ?? []) {
      const existing = project.definitions[definition.id]
      if (existing && !equalComponentValue(existing, definition)) throw new Error('新对象不能覆盖其他实例正在使用的定义')
      if (!existing) edits.push({ type: 'definition.set', definition })
    }
    const instances: ComponentInstance[] = []
    const allocate = (draft: ContentObjectDraft, parentLayout = nativeParent): string => {
      const id = input.createId()
      const native = (flow || nativeParent) && isNativeFlowLayoutGroup(draft, definitions[draft.definitionId])
      const children = draft.children?.map(child => allocate(child, native))
      const style = draft.style ? Object.fromEntries(Object.entries(draft.style).filter(([name]) => !isOuterGeometryStyle(name)
        || native && isNativeFlowContainerStyle(name) || (native || parentLayout) && isNativeFlowItemStyle(name)
        || flow && isFlowStickyStyle(draft, name)
        || draft.viewportPinned && ['width', 'height'].includes(name) && draft.style![name] === '100%').map(([name, value]) => [cssStyleName(name), value])) : undefined
      instances.push({ id, definitionId: draft.definitionId, data: structuredClone(draft.data),
        ...(draft.name !== undefined ? { name: draft.name } : {}), ...(draft.flowLayout ? { flowLayout: structuredClone(draft.flowLayout) } : {}),
        ...(draft.viewportPinned !== undefined ? { viewportPinned: draft.viewportPinned } : {}),
        ...(draft.authoring ? { authoring: structuredClone(draft.authoring) } : {}),
        ...(style ? { style: structuredClone(style) } : {}), ...(draft.frame ? { frame: structuredClone(draft.frame) } : {}),
        ...(draft.implementationOverride ? { implementationOverride: structuredClone(draft.implementationOverride) } : {}),
        ...(children ? { childIds: children } : {}) })
      insertedIds.push(id)
      return id
    }
    const flow = layoutContainer(project, container)?.kind === 'flow'
    const parent = container.kind === 'instance' ? project.instances[container.instanceId] : undefined
    const nativeParent = Boolean(parent && isNativeFlowLayoutGroup(parent, project.definitions[parent.definitionId]))
    const definitions = { ...project.definitions, ...(request.source.kind === 'objects'
      ? Object.fromEntries((request.source.definitions ?? []).map(definition => [definition.id, definition])) : {}) }
    for (const edit of edits) if (edit.type === 'definition.set') definitions[edit.definition.id] = edit.definition
    const region = contentPlacementRegion(request)
    const placed = nativeParent ? drafts : flow ? (region ? drafts.map(draft => draft.frame ? draft : { ...draft, frame: { ...region } }) : drafts)
      .map(draft => flowBodyDraft(draft, definitions))
      : region ? placeInRegion(project, container, drafts, region, diagnostics, request.intent === 'insert')
        : request.intent === 'insert' && !input.preserveLayout ? placeNewRoots(project, container, drafts, diagnostics, definitions) : drafts
    if (request.intent === 'redo' && request.target.kind === 'instance') {
      const target = project.instances[request.target.instanceId]!
      const removed = new Set((target.childIds ?? []).flatMap(id => contentTargetIds(project, { target: { kind: 'instance', instanceId: id } })))
      const detached = new Set<string>()
      for (const childId of target.childIds ?? []) for (const expected of captureComponentOperation(project, [{ type: 'instance.remove', instanceId: childId }], [], options).expected) {
        const path = expected.path
        if (path[0] === 'instances' && !removed.has(path[1]!) && ['data', 'attachments', 'flowPlacement'].includes(path[2]!)
          || path[0] === '@surface' && ['presentation', 'spatial'].includes(path[2]!)) detached.add(path.join('.'))
      }
      for (const reference of detached) diagnostics.push({ level: 'warning', code: 'redo-internal-reference-detached', instanceId: target.id, reference,
        message: `关联位置 ${reference} 引用已替换的旧内部对象，已沿正式删除规则解除；选定目标本身的身份、外框与关联保留。`, repairable: true })
      for (const childId of target.childIds ?? []) edits.push({ type: 'instance.remove', instanceId: childId })
      let root: ContentObjectDraft
      if (placed.length === 1) root = placed[0]!
      else {
        let definitionId = GROUP_DEFINITION.id
        if (definitions[definitionId] && !equalComponentValue(definitions[definitionId], GROUP_DEFINITION)) {
          definitionId = input.createId()
        }
        if (!definitions[definitionId]) edits.push({ type: 'definition.set', definition: { ...GROUP_DEFINITION, id: definitionId } })
        root = { definitionId, data: {}, children: placed }
      }
      edits.push({ type: 'instance.definition.set', instanceId: target.id, definitionId: root.definitionId },
        { type: 'data.set', instanceId: target.id, path: [], value: structuredClone(root.data) },
        { type: 'authoring.set', instanceId: target.id, path: [], value: structuredClone(root.authoring ?? {}) as unknown as JsonValue },
        { type: 'style.set', instanceId: target.id, path: [], value: Object.fromEntries(Object.entries(root.style ?? {})
          .filter(([name]) => !isOuterGeometryStyle(name)).map(([name, value]) => [cssStyleName(name), structuredClone(value)])) },
        { type: 'implementation.set', instanceId: target.id, implementation: root.implementationOverride ?? null })
      const childIds = (root.children ?? []).map(child => allocate(child, !target.frame && isNativeFlowLayoutGroup(root, definitions[root.definitionId])))
      if (childIds.length) edits.push({ type: 'instance.insert', container: { kind: 'instance', instanceId: target.id }, index: 0, instances, rootIds: childIds })
      insertedIds.unshift(target.id)
      // No frame edit: redo grants new internal content, not a move or resize of the selected object.
    } else if (placed.length) edits.push({ type: 'instance.insert', container, index, instances, rootIds: placed.map(draft => allocate(draft)) })
  } else if (request.intent === 'style') {
    if (request.source.kind !== 'style') throw new Error('样式意图需要明确的样式字段')
    const style = request.source.style
    for (const instanceId of contentTargetIds(project, request)) {
      const instance = project.instances[instanceId]!
      const next = applyComponentStylePatch(instance.style, style, (name, reason) => diagnostics.push(reason === 'geometry'
        ? { level: 'info', code: 'frame-style-preserved', instanceId, message: `外层 ${name} 由正式 frame 持有，样式修改未改变它。` }
        : { level: 'warning', code: 'unsupported-css-value', instanceId, message: `${name} 不是当前 CSS consumer 支持的标量样式值，已保留其余样式。`, repairable: true }),
      componentFlowStylePolicy(project, instance, style))
      if (!equalComponentValue(project.instances[instanceId]?.style ?? {}, next)) edits.push({ type: 'style.set', instanceId, path: [], value: next })
    }
  } else if (request.source.kind === 'data') {
    if (request.target.kind !== 'instance') throw new Error('专业字段修改需要一个确定对象')
    const instanceId = request.target.instanceId
    if (!project.instances[instanceId]) throw new Error('目标对象已不存在')
    let owner = owningContainer(baseProject, instanceId)
    while (owner?.kind === 'instance') owner = owningContainer(baseProject, owner.instanceId)
    edits.push(...componentDataEdits(baseProject, { instanceId,
      surfaceId: context?.surfaceId ?? (owner?.kind === 'surface' ? owner.surfaceId : null), stateId: context?.stateId },
    { kind: 'fields', fields: request.source.fields }))
    if (request.source.implementation !== undefined) edits.push({ type: 'implementation.set', instanceId, implementation: request.source.implementation })
  } else if (request.source.kind !== 'html') throw new Error('内容意图需要局部 HTML 或专业字段')
  const mapped = context ? presentationComponentEdits(baseProject, context.surfaceId, context.stateId, edits, options) : edits
  return { command: captureComponentOperation(baseProject, mapped, [], options), diagnostics, input: request, insertedIds,
    usability: input.unusable ? 'unusable' : diagnostics.some(item => item.level !== 'info') ? 'partial' : input.unverified ? 'unverified' : 'usable' }
}
