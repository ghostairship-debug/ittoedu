import type { CourseAuthoringTarget } from '../authoring/courseAuthoringSession'
import { admitDynamicCandidate } from '../authoring/tools/dynamicCandidateAdmission'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import { componentPackageAdmissionTargets } from '../components/componentPackageRevision'
import { componentCaptureAsset } from '../../core/tools/dynamicCaptureAssets'
import { bytesToBase64 } from '../export/base64'
import type { HistoryResourceState } from '../store/courseResourceState'
import type { AuthoringToolSelectionV1 } from '../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { DynamicInstanceCapture } from '../../shared/dynamicAdmissionContract'
import {
  convertFlowOverlayComponentToDocument,
  inspectFlowOverlayComponentConversion,
  type FlowBodyDestination,
} from './flowSharedAuthoringAdapters'
import { selectFlowOverlay } from './flowEditorSlice'

export const FLOW_COMPONENT_CONVERSION_CANCELLED_REASON = '组件转正文已取消，未写入工程'

type AdmitDynamicCandidate = typeof admitDynamicCandidate

export interface PrepareFlowOverlayComponentConversionInput {
  readonly project: CourseProjectDocument
  readonly resources: HistoryResourceState
  readonly target: CourseAuthoringTarget
  readonly destination: FlowBodyDestination
  readonly now?: string
}

export interface FlowComponentConversionDependencies {
  readonly admit?: AdmitDynamicCandidate
}

function validCurrentFallback(
  project: CourseProjectDocument,
  resources: HistoryResourceState,
  fallbackAssetId: string | undefined,
  instanceId: string,
  locationId: string,
): string | null {
  if (!fallbackAssetId) return null
  const meta = project.assets[fallbackAssetId]
  const bytes = resources.assetFiles[fallbackAssetId]
  if (
    !meta
    || !bytes
    || meta.kind !== 'image'
    || meta.mimeType !== 'image/png'
    || meta.byteLength !== bytes.byteLength
    || !meta.width
    || !meta.height
  ) {
    return null
  }
  try {
    componentCaptureAsset({
      instanceId,
      locationId,
      width: meta.width,
      height: meta.height,
      dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
    }, fallbackAssetId)
    return fallbackAssetId
  } catch {
    return null
  }
}

function exactAdmissionTargets(
  project: CourseProjectDocument,
  packageId: string,
  locationId: string,
  instanceId: string,
) {
  const target = componentPackageAdmissionTargets(project, packageId).find((candidate) => (
    candidate.locationId === locationId
    && (candidate.stateId ?? null) === null
    && candidate.instanceIds.includes(instanceId)
  ))
  if (!target) throw new Error('当前组件实例没有可用的真实宿主准入目标')
  return [{ ...target, instanceIds: [instanceId] }]
}

function findExactCapture(
  captures: readonly DynamicInstanceCapture[],
  instanceId: string,
  locationId: string,
): DynamicInstanceCapture {
  const capture = captures.find((candidate) => (
    candidate.instanceId === instanceId && candidate.locationId === locationId
  ))
  if (!capture) throw new Error(`组件实例 ${instanceId} 缺少当前页面的真实后备图面`)
  return capture
}

/**
 * Prepares one atomic resource + document transaction. This function never
 * writes Store state; the caller must revalidate the captured target after the
 * asynchronous host admission before committing the returned plan.
 */
export async function prepareFlowOverlayComponentConversion(
  input: PrepareFlowOverlayComponentConversionInput,
  signal?: AbortSignal,
  dependencies: FlowComponentConversionDependencies = {},
): Promise<EditorTransactionPlan<AuthoringToolSelectionV1>> {
  if (signal?.aborted) throw new Error(FLOW_COMPONENT_CONVERSION_CANCELLED_REASON)
  if (
    input.project.id !== input.target.projectId
    || input.project.revision !== input.target.documentRevision
    || input.target.owner !== 'surface'
    || input.target.stateId !== null
  ) {
    throw new Error('组件转换目标与当前 Flow 工程不一致')
  }
  const selection = selectFlowOverlay(
    input.project,
    input.target.locationId,
    [input.target.itemId],
    'page',
  )
  const inspection = inspectFlowOverlayComponentConversion(
    input.project,
    selection,
    input.destination,
  )
  if (!inspection.ok) throw new Error(inspection.reason)
  if (inspection.overlayId !== input.target.itemId || inspection.surfaceId !== input.target.surfaceId) {
    throw new Error('组件转换目标已经改变')
  }

  let fallbackAssetId = validCurrentFallback(
    input.project,
    input.resources,
    inspection.item.staticFallbackAssetId,
    inspection.overlayId,
    inspection.locationId,
  )
  let capturedAsset: ReturnType<typeof componentCaptureAsset> | null = null
  if (!fallbackAssetId) {
    const captures = await (dependencies.admit ?? admitDynamicCandidate)(
      input.project,
      input.resources,
      exactAdmissionTargets(
        input.project,
        inspection.item.component.packageId,
        inspection.locationId,
        inspection.overlayId,
      ),
      signal,
      true,
    )
    if (signal?.aborted) throw new Error(FLOW_COMPONENT_CONVERSION_CANCELLED_REASON)
    capturedAsset = componentCaptureAsset(findExactCapture(
      captures,
      inspection.overlayId,
      inspection.locationId,
    ))
    fallbackAssetId = capturedAsset.meta.id
  }

  const converted = convertFlowOverlayComponentToDocument(
    input.project,
    selection,
    {
      expectedRevision: input.target.documentRevision,
      destination: input.destination,
      fallbackAssetId,
      ...(capturedAsset ? { fallbackAsset: capturedAsset.meta } : {}),
      ...(input.now ? { now: input.now } : {}),
    },
  )
  const blockId = converted.createdBlockIds?.[0]
  if (!converted.ok || !converted.nextDocument || !blockId) {
    throw new Error(converted.reason ?? '组件未能转换为正文块')
  }
  return Object.freeze({
    projectId: input.project.id,
    baseRevision: input.project.revision,
    nextDocument: converted.nextDocument,
    resourceChanges: capturedAsset
      ? { assetFileChanges: [{ assetId: capturedAsset.meta.id, after: capturedAsset.bytes }] }
      : {},
    selectionHint: {
      kind: 'authoring-tool-selection',
      locationId: inspection.locationId,
      stateId: null,
      owner: 'surface',
      itemIds: [blockId],
      flowCarrier: 'block',
    } satisfies AuthoringToolSelectionV1,
  })
}
