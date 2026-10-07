import type { ComponentEdit, CourseProjectV10 } from '../../shared/contracts/component-platform'
import type { DocumentBlock } from '../../shared/document/content'
import { walkDocument } from '../../shared/document/content'
import type { DocumentResources } from '../../shared/document/resources'
import { documentResourcesSchema } from '../../shared/document/resources'
import { applyComponentOperation, captureComponentOperation } from '../../core/drivers/courseV10Operations'
import { flowDocumentEdits } from '../../core/components/document/flowDocumentProjection'
import { owningContainer, resolveComponentPresentation } from '../../shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { prepareCourseObjectPaste, type CourseObjectClipboardSource } from '../composition/crossSurfaceCommands'
import type { DocumentClipboardResourcePort } from './documentClipboard'

/** Opaque preparation; its captured project, files and body share one destination. */
export interface FlowPreparedDocumentResources {
  readonly target: CapturedCourseTarget
  readonly edits: readonly ComponentEdit[]
}
const staged = new WeakSet<FlowPreparedDocumentResources>()

function preparedBatches(values: readonly unknown[]): FlowPreparedDocumentResources[] {
  return [...new Set(values)].map(value => {
    if (!value || typeof value !== 'object' || !staged.has(value as FlowPreparedDocumentResources)) throw new Error('正文资源准备已失效')
    return value as FlowPreparedDocumentResources
  })
}
function sameOwner(left: CapturedCourseTarget, right: CapturedCourseTarget): boolean {
  return left.documentId === right.documentId && left.epoch === right.epoch && left.project.id === right.project.id
    && left.surfaceId === right.surfaceId && left.activeStateId === right.activeStateId
}
function preparedProject(target: CapturedCourseTarget, batches: readonly FlowPreparedDocumentResources[]): CourseProjectV10 {
  let project = target.project
  for (const batch of batches) {
    if (!sameOwner(target, batch.target)) throw new Error('正文资源不属于当前捕获目标')
    project = applyComponentOperation(project, captureComponentOperation(project, [...batch.edits]))
  }
  return project
}

/** Includes pending bytes only for subsequent preparation, never a second resource writer. */
function preparedTarget(target: CapturedCourseTarget, batches: readonly FlowPreparedDocumentResources[]): CapturedCourseTarget {
  const base = batches[0]?.target ?? target
  const resources = structuredClone(base.resources)
  for (const batch of batches) for (const edit of batch.edits) {
    if (edit.type === 'asset.add') resources.assets[edit.asset.id] = edit.bytes.slice()
    if (edit.type === 'component.files.set') {
      if (edit.files) resources.components[edit.ownerId] = structuredClone(edit.files)
      else delete resources.components[edit.ownerId]
    }
  }
  const project = preparedProject(base, batches)
  return { ...base, project, editingProject: resolveComponentPresentation(project, base.surfaceId, base.activeStateId), resources }
}
/** Copying a retained local object uses the same staged identity/files snapshot as its body. */
export function captureFlowPreparedDocumentResources(target:CapturedCourseTarget,values:readonly FlowPreparedDocumentResources[]):CapturedCourseTarget {
  const batches=values.filter(value=>staged.has(value) && sameOwner(value.target,target))
  return batches.length ? preparedTarget(target,batches):target
}

/** The existing clone planner owns IDs, declared references, assets and private source files. */
export function createFlowDocumentResourcePort(input: {
  target: CapturedCourseTarget
  source: CourseObjectClipboardSource
  pending?(): readonly FlowPreparedDocumentResources[]
  onPrepared?(prepared: FlowPreparedDocumentResources): void
  onDiscard?(prepared: FlowPreparedDocumentResources): void
}): DocumentClipboardResourcePort<FlowPreparedDocumentResources> {
  const target = structuredClone(input.target), source = structuredClone(input.source)
  return {
    async prepareResources({ resources, content, identity }) {
      documentResourcesSchema.parse(resources)
      const previous = (input.pending?.() ?? []).filter(value => staged.has(value) && sameOwner(value.target, target))
      const destination = preparedTarget(target, previous)
      const chosen = new Set<string>()
      walkDocument(content.blocks, block => { if (source.project.instances[block.id]) chosen.add(block.id) })
      const roots = [...chosen].filter(id => {
        let owner = owningContainer(source.project, id)
        while (owner?.kind === 'instance') {
          if (chosen.has(owner.instanceId)) return false
          owner = owningContainer(source.project, owner.instanceId)
        }
        return true
      })
      if (resources.components.length) throw new Error('当前正文组件需要正式 V10 实例及源码，不能只粘贴旧组件包引用')
      const plan = roots.length ? prepareCourseObjectPaste({ ...source, roots }, {
        capturedTarget: destination, container: { kind: 'surface', surfaceId: target.surfaceId! },
        index: destination.editingProject.surfaces.find(surface => surface.id === target.surfaceId)!.childIds.length,
        identity: identity ?? 'copy',
      }) : { edits: [], idMap: new Map<string, string>(), assetIds: new Map<string, string>(), rootIds: [] }
      const assetIds = Object.fromEntries(plan.assetIds)
      const mapped: DocumentResources = { assets: resources.assets.map(ref => {
        const assetId = assetIds[ref.assetId]
        if (!assetId) throw new Error(`复制素材没有正式实例闭包：${ref.assetId}`)
        return { assetId, source: { kind: 'project' } }
      }), components: [] }
      const prepared: FlowPreparedDocumentResources = { target: previous[0]?.target ?? target, edits: plan.edits }
      staged.add(prepared); input.onPrepared?.(prepared)
      return { resources: mapped, assetIds, components: [], identities: Object.fromEntries(plan.idMap), prepared }
    },
    async discard(prepared) { staged.delete(prepared); input.onDiscard?.(prepared) },
  }
}

/** Resolves the editor's provisional object shell before the formal ACK is rendered. */
export function projectFlowPreparedResources(target: CapturedCourseTarget, values: readonly FlowPreparedDocumentResources[]): CourseProjectV10 {
  const batches = values.filter(value => staged.has(value) && sameOwner(value.target, target))
  return batches.length ? preparedTarget(batches[0].target, batches).editingProject : target.editingProject
}

/** One formal operation contains every resource edit and the complete body projection. */
export function prepareFlowDocumentResourceTransaction(target: CapturedCourseTarget, surfaceId: string, blocks: DocumentBlock[], values: readonly unknown[]): {
  target: CapturedCourseTarget; edits: ComponentEdit[]; prepared: readonly FlowPreparedDocumentResources[]
} {
  const batches = preparedBatches(values), captured = batches[0]?.target ?? target
  if (!sameOwner(captured, target) || captured.surfaceId !== surfaceId) throw new Error('正文资源目标已变化，请回到原稿后继续')
  const project = batches.length ? preparedProject(captured, batches) : captured.editingProject
  const edits = [...batches.flatMap(batch => [...batch.edits]), ...flowDocumentEdits(project, surfaceId, blocks, captured.editingProject)]
  // Resource copy batches are canonical already. Flow has no persisted named states;
  // the final capture must not reinterpret a complete clone as a presentation edit.
  return { target: batches.length ? { ...captured, activeStateId: null, editingProject: captured.project } : captured, edits, prepared: batches }
}
export function releaseFlowPreparedResources(values: readonly FlowPreparedDocumentResources[]): void {
  values.forEach(value => staged.delete(value))
}
export function retainedFlowPreparedResources(target: CapturedCourseTarget, values: readonly FlowPreparedDocumentResources[]): FlowPreparedDocumentResources[] {
  return values.filter(value => staged.has(value) && sameOwner(value.target,target))
}
