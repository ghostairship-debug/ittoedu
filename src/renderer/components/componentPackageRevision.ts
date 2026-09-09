import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { analyzeCourseAssetReferences } from '../../shared/contracts/course-project-v9/assetReferences'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import type { DynamicInstanceCapture } from '../../shared/dynamicAdmissionContract'
import type { DynamicBehaviorObservation } from '../../shared/dynamicBehaviorObservation'
import type { HistoryResourceState, AssetFileHistoryChange } from '../store/courseResourceState'
import { applyHistoryResourceChanges } from '../store/courseResourceState'
import { admitDynamicCandidate } from '../authoring/tools/dynamicCandidateAdmission'
import { parseComponentPackageFiles } from './importComponentPackage'
import { componentPackageMeta, rewriteComponentDefinitionId, validateEditableComponentPackage } from './editableComponentPackage'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import {
  collectCourseComponentPackageReferences,
  planCourseComponentPackageReplacement,
  visitCourseComponentPackageInstances,
  type CourseComponentPackageReplacementPlanResult,
} from './courseComponentPackageTransactions'

export interface ComponentPackageSourceBaseline {
  readonly packageId: string
  readonly baseVersion: string
  readonly baseContentIdentity: string
  readonly projectId: string
  readonly documentRevision: number
}

export function captureComponentPackageSourceBaseline(project: CourseProjectDocument, packageId: string): ComponentPackageSourceBaseline {
  const meta = project.componentPackages[packageId]
  if (!meta?.contentSha256) throw new Error('工程组件包或源码身份不可用')
  return Object.freeze({ packageId, baseVersion: meta.version, baseContentIdentity: meta.contentSha256, projectId: project.id, documentRevision: project.revision })
}

export function assertComponentPackageSourceBaseline(project: CourseProjectDocument, baseline: ComponentPackageSourceBaseline): void {
  const current = captureComponentPackageSourceBaseline(project, baseline.packageId)
  if (Object.keys(current).some(key => current[key as keyof typeof current] !== baseline[key as keyof typeof baseline])) {
    throw new Error('stale：工程或组件源码基线已改变，请保留草稿并重新载入目标')
  }
}

/** A fork preserves source behavior and explicitly retargets one instance. */
export function planComponentPackageFork(project: CourseProjectDocument, packages: Readonly<Record<string, ComponentPackageData>>,
  packageId: string, nextId: string, instanceId?: string): EditorTransactionPlan {
  const source = packages[packageId]
  if (!source || !project.componentPackages[packageId] || project.componentPackages[nextId]) throw new Error('组件副本身份无效')
  const references = collectCourseComponentPackageReferences(project, packageId)
  const reference = instanceId ? references.find(ref => ref.instanceId === instanceId) : undefined
  if (instanceId && !reference) throw new Error('所选实例与组件包不一致')
  const manifest = { ...source.manifest, id: nextId, name: `${source.manifest.name}（独立副本）`, version: '0.1.0' }
  const encoder = new TextEncoder()
  const files = { ...source.files, 'manifest.json': encoder.encode(JSON.stringify(manifest, null, 2)),
    [source.manifest.entry]: encoder.encode(rewriteComponentDefinitionId(source.runtimeSource, packageId, nextId)) }
  const replacement = parseComponentPackageFiles(files)
  validateEditableComponentPackage(replacement, null, reference ? [reference.scope] : [])
  const next = structuredClone(project)
  next.componentPackages[nextId] = componentPackageMeta(replacement, { editableCopy: true, sourcePackageId: project.componentPackages[packageId]!.sourcePackageId ?? packageId })
  visitCourseComponentPackageInstances(next, packageId, (instance, ref) => {
    if (ref.instanceId === instanceId) instance.component = { packageId: nextId, version: replacement.manifest.version }
  })
  next.revision++
  next.updatedAt = new Date().toISOString()
  return { projectId: project.id, baseRevision: project.revision, nextDocument: courseProjectDocumentSchema.parse(next),
    resourceChanges: { componentPackageChanges: [{ packageId: nextId, after: replacement }] } }
}

/** Complete files are authoritative: switching entry never overwrites that file with an old editor draft. */
export function planComponentPackageSourceRevision(input: {
  project: CourseProjectDocument
  resources: HistoryResourceState
  baseline: ComponentPackageSourceBaseline
  files: Readonly<Record<string, Uint8Array>>
  operationId: string
}): CourseComponentPackageReplacementPlanResult {
  assertComponentPackageSourceBaseline(input.project, input.baseline)
  const { packageId, baseVersion } = input.baseline
  const source = input.resources.componentPackages[packageId]
  if (!source) throw new Error('组件源码资源不可用')
  const parsed = parseComponentPackageFiles(input.files, { expectedId: packageId, expectedVersion: baseVersion })
  if (componentContentSha256(parsed.files) === input.baseline.baseContentIdentity) {
    return planCourseComponentPackageReplacement({ project: input.project, componentPackages: input.resources.componentPackages,
      packageId, replacement: source, expected: { projectId: input.project.id, revision: input.project.revision }, now: new Date().toISOString() })
  }
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.operationId)) throw new Error('组件修订操作身份无效')
  const version = `${baseVersion.split(/[-+]/)[0]}-edit.${input.operationId.toLowerCase()}`
  const manifest = { ...parsed.manifest, version }
  const files = { ...parsed.files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }
  const replacement: ComponentPackageData = parseComponentPackageFiles(files, { expectedId: packageId, expectedVersion: version })
  // parse(files) intentionally drops old archive provenance; this is a new source revision.
  return planCourseComponentPackageReplacement({ project: input.project, componentPackages: input.resources.componentPackages,
    packageId, replacement, expected: { projectId: input.project.id, revision: input.project.revision }, now: new Date().toISOString() })
}

export function componentPackageAdmissionTargets(project: CourseProjectDocument, packageId: string) {
  const refs = collectCourseComponentPackageReferences(project, packageId)
  return project.locations.flatMap(location => {
    const instanceIds = refs.filter(ref => ref.carrier === 'global-layer'
      || ref.surfaceId === location.surfaceId && (!ref.sceneId || location.kind === 'slide-scene' && ref.sceneId === location.sceneId)).map(ref => ref.instanceId)
    if (!instanceIds.length) return []
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)
    const states = surface?.type === 'slide' && location.kind === 'slide-scene'
      ? surface.scenes.find(scene => scene.id === location.sceneId)?.presentation?.states.map(state => state.id) ?? [] : []
    return (states.length ? states : [null]).map(stateId => ({ locationId: location.id, stateId, instanceIds }))
  })
}

/** Capture bytes are checked before either document or resources can be committed. */
export function componentCaptureAsset(capture: DynamicInstanceCapture, id = `component-capture-${crypto.randomUUID()}`) {
  const prefix = 'data:image/png;base64,'
  if (!capture.dataUrl.startsWith(prefix)) throw new Error('组件后备不是PNG图面')
  const bytes = Uint8Array.from(atob(capture.dataUrl.slice(prefix.length)), char => char.charCodeAt(0))
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((value, i) => bytes[i] !== value)) throw new Error('组件后备PNG内容无效')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(16) !== capture.width || view.getUint32(20) !== capture.height) throw new Error('组件后备PNG尺寸不一致')
  return { bytes, meta: { id, filename: `${id}.png`, path: `assets/${id}.png`, kind: 'image' as const,
    mimeType: 'image/png', byteLength: bytes.length, width: capture.width, height: capture.height } }
}

/** Manual and AI edits share the same replacement planner, all-instance admission and resource transaction. */
export async function prepareComponentPackageSourceRevision(input: Parameters<typeof planComponentPackageSourceRevision>[0], signal?: AbortSignal,
  onBehaviorEvidence?: (evidence: readonly DynamicBehaviorObservation[]) => void): Promise<CourseComponentPackageReplacementPlanResult> {
  const result = planComponentPackageSourceRevision(input)
  return prepareComponentPackageRevision(result, input.resources, input.baseline.packageId, signal, onBehaviorEvidence)
}

export async function prepareComponentPackageRevision(result: CourseComponentPackageReplacementPlanResult, resources: HistoryResourceState,
  packageId: string, signal?: AbortSignal, onBehaviorEvidence?: (evidence: readonly DynamicBehaviorObservation[]) => void): Promise<CourseComponentPackageReplacementPlanResult> {
  if (!result.ok || result.status === 'no-op') return result
  const next = result.plan.nextDocument
  const targets = componentPackageAdmissionTargets(next, packageId)
  if (!targets.length) throw new Error('组件源码准入需要工程内实际实例')
  const nextResources = applyHistoryResourceChanges(resources, result.plan.resourceChanges, 'forward')
  const captures = await admitDynamicCandidate(next, nextResources, targets, signal, true, { onBehaviorEvidence })
  if (signal?.aborted) throw new Error('组件源码校验已取消')
  const document = structuredClone(next)
  const assetFileChanges: AssetFileHistoryChange[] = []
  const previousCaptures = new Set<string>()
  visitCourseComponentPackageInstances(document, packageId, (instance, reference) => {
    const capture = captures.find(item => item.instanceId === reference.instanceId)
    if (!capture) throw new Error(`实例 ${reference.instanceId} 缺少真实后备图面`)
    const asset = componentCaptureAsset(capture)
    if (instance.staticFallbackAssetId?.startsWith('component-capture-')) previousCaptures.add(instance.staticFallbackAssetId)
    document.assets[asset.meta.id] = asset.meta
    instance.staticFallbackAssetId = asset.meta.id
    assetFileChanges.push({ assetId: asset.meta.id, after: asset.bytes })
  })
  const references = analyzeCourseAssetReferences(document, { componentPackages: nextResources.componentPackages })
  if (!references.missingComponentContexts.length) for (const assetId of previousCaptures) {
    if (references.graph.has(assetId)) continue
    delete document.assets[assetId]
    const before = resources.assetFiles[assetId]
    if (before) assetFileChanges.push({ assetId, before })
  }
  return { ...result, plan: { ...result.plan, nextDocument: courseProjectDocumentSchema.parse(document),
    resourceChanges: { ...result.plan.resourceChanges, assetFileChanges } } }
}
