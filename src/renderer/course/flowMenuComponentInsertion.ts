import { componentCaptureAsset } from '../../core/tools/dynamicCaptureAssets'
import { findFlowBlockRecursive, flowSurfaceIn } from '../../core/tools/flowDocumentModel'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import { mergeComponentProps, resolveComponentPresetProps } from '../../shared/componentProps'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DynamicInstanceCapture } from '../../shared/dynamicAdmissionContract'
import { admitDynamicCandidate } from '../authoring/tools/dynamicCandidateAdmission'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import type { HistoryResourceState } from '../store/courseResourceState'
import { componentPackageAdmissionTargets } from '../components/componentPackageRevision'
import { insertFlowEditorBlock } from './flowEditorCommands'
import { clearFlowEditorSelection } from './flowEditorSlice'
import { insertFlowSharedComponent, type FlowBodyDestination } from './flowSharedAuthoringAdapters'

export const FLOW_MENU_COMPONENT_CANCELLED_REASON = '正文组件插入已取消，未写入工程'

export interface FlowMenuComponentInsertionInput {
  readonly project: CourseProjectDocument
  readonly resources: HistoryResourceState
  readonly target: {
    readonly projectId: string
    readonly documentRevision: number
    readonly locationId: string
    readonly surfaceId: string
  }
  readonly destination: FlowBodyDestination
  readonly packageId: string
  readonly packageData?: ComponentPackageData
  readonly presetId?: string
  readonly props?: Readonly<Record<string, unknown>>
  readonly width: number
  readonly height: number
  readonly now?: string
}

type Admit = typeof admitDynamicCandidate

function resolvedPackage(input: FlowMenuComponentInsertionInput): ComponentPackageData {
  const data = input.packageData ?? input.resources.componentPackages[input.packageId]
  if (!data || data.manifest.id !== input.packageId) throw new Error('组件包与当前插入目标不一致')
  const embedded = input.project.componentPackages[input.packageId]
  if (embedded && (embedded.version !== data.manifest.version || embedded.contentSha256 !== componentPackageMeta(data).contentSha256)) {
    throw new Error('组件包与工程内版本不同，请先审阅更新')
  }
  if (!componentSupportsScope(data.manifest, 'scene')) throw new Error('该组件不支持当前作者范围')
  return data
}

function findCapture(captures: readonly DynamicInstanceCapture[], instanceId: string, locationId: string): DynamicInstanceCapture {
  const matches = captures.filter(capture => capture.instanceId === instanceId && capture.locationId === locationId)
  if (matches.length !== 1) throw new Error('组件实例缺少当前页面的唯一真实后备图面')
  return matches[0]!
}

/** Returns one uncommitted step. The caller must revalidate its frozen target before committing. */
export async function prepareFlowMenuComponentInsertion(
  input: FlowMenuComponentInsertionInput,
  signal?: AbortSignal,
  dependencies: { readonly admit?: Admit } = {},
): Promise<EditorTransactionStep> {
  if (signal?.aborted) throw new Error(FLOW_MENU_COMPONENT_CANCELLED_REASON)
  const frozen = structuredClone(input)
  const { project, resources, target, destination } = frozen
  if (project.id !== target.projectId || project.revision !== target.documentRevision) throw new Error('正文组件插入目标与工程版本不一致')
  const location = project.locations.find(value => value.id === target.locationId)
  if (!location || location.kind !== 'flow-block' || location.surfaceId !== target.surfaceId) throw new Error('正文组件插入位置不是当前 Flow 页面')
  const surface = flowSurfaceIn(project, target.surfaceId)
  if (!Number.isInteger(destination.index) || destination.index < 0) throw new Error('正文插入位置无效')
  const siblings = destination.parentBlockId === null ? surface.blocks : (() => {
    const found = findFlowBlockRecursive(surface.blocks, destination.parentBlockId)
    if (!found || found.block.type !== 'section') throw new Error('正文插入分节已经失效')
    return found.block.blocks
  })()
  if (destination.index > siblings.length) throw new Error('正文插入位置已经失效')
  if (!Number.isFinite(frozen.width) || !Number.isFinite(frozen.height) || frozen.width < 1 || frozen.height < 1 || frozen.width > 4096 || frozen.height > 4096) {
    throw new Error('组件图面尺寸无效')
  }
  const data = resolvedPackage(frozen)
  const presetProps = frozen.presetId ? resolveComponentPresetProps(data.manifest, frozen.presetId) : data.manifest.defaultProps
  const props = mergeComponentProps({ ...data.manifest, defaultProps: presetProps }, frozen.props ?? {})
  const candidate = structuredClone(project)
  if (!candidate.componentPackages[frozen.packageId]) candidate.componentPackages[frozen.packageId] = componentPackageMeta(data)
  const candidateResources: HistoryResourceState = {
    assetFiles: resources.assetFiles,
    componentPackages: { ...resources.componentPackages, [frozen.packageId]: data },
  }
  const temporary = insertFlowSharedComponent(candidate, clearFlowEditorSelection(candidate, target.locationId), {
    packageId: frozen.packageId,
    manifest: data.manifest,
    placement: 'viewport-overlay',
    props,
  }, { ...(frozen.now ? { now: frozen.now } : {}), expectedRevision: project.revision })
  const instanceId = temporary.createdLayerItemIds?.[0]
  if (!temporary.ok || !temporary.nextDocument || !instanceId) throw new Error(temporary.reason ?? '无法准备临时组件图面')
  const paper = structuredClone(temporary.nextDocument)
  const paperSurface = flowSurfaceIn(paper, target.surfaceId)
  const temporaryEntry = paperSurface.surfaceLayerItems.find(entry => entry.item.layerItemId === instanceId)
  if (!temporaryEntry || temporaryEntry.item.kind !== 'component') throw new Error('临时组件实例已经失效')
  temporaryEntry.item.paperSpace = 'paper'
  temporaryEntry.item.frame = { ...temporaryEntry.item.frame, width: frozen.width, height: frozen.height }
  const admissionProject = courseProjectDocumentSchema.parse(paper)
  const exact = componentPackageAdmissionTargets(admissionProject, frozen.packageId).find(value =>
    value.locationId === target.locationId && (value.stateId ?? null) === null && value.instanceIds.includes(instanceId))
  if (!exact) throw new Error('临时组件没有当前页面的准入目标')
  const captures = await (dependencies.admit ?? admitDynamicCandidate)(admissionProject, candidateResources,
    [{ ...exact, instanceIds: [instanceId] }], signal, true)
  if (signal?.aborted) throw new Error(FLOW_MENU_COMPONENT_CANCELLED_REASON)
  const asset = componentCaptureAsset(findCapture(captures, instanceId, target.locationId))
  if (project.assets[asset.meta.id] || resources.assetFiles[asset.meta.id]) throw new Error('组件后备资源身份冲突')

  const finalBase = structuredClone(project)
  if (!finalBase.componentPackages[frozen.packageId]) finalBase.componentPackages[frozen.packageId] = componentPackageMeta(data)
  finalBase.assets[asset.meta.id] = asset.meta
  const inserted = insertFlowEditorBlock(finalBase, {
    surfaceId: target.surfaceId, parentId: destination.parentBlockId, index: destination.index,
    block: { type: 'component', component: { packageId: frozen.packageId, version: data.manifest.version },
      props, staticFallbackAssetId: asset.meta.id,
      ...(destination.wrap && destination.wrap !== 'none' ? { wrap: destination.wrap } : {}) },
  }, { ...(frozen.now ? { now: frozen.now } : {}), expectedRevision: project.revision })
  const blockId = inserted.createdBlockIds?.[0]
  if (!inserted.ok || !inserted.nextDocument || !blockId) throw new Error(inserted.reason ?? '无法插入正文组件')
  const finalDocument = courseProjectDocumentSchema.parse(inserted.nextDocument)
  const step = createEditorTransactionStep(project, {
    projectId: project.id, baseRevision: project.revision, nextDocument: finalDocument,
    resourceChanges: {
      assetFileChanges: [{ assetId: asset.meta.id, after: asset.bytes }],
      ...(!project.componentPackages[frozen.packageId] ? { componentPackageChanges: [{ packageId: frozen.packageId, after: data }] } : {}),
    },
    selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: null,
      owner: 'surface', itemIds: [blockId], flowCarrier: 'block' },
  })
  if (!step) throw new Error('正文组件插入没有产生事务')
  return step
}
