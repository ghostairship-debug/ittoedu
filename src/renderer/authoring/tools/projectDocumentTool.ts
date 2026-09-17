import { z } from 'zod'
import { courseProjectDocumentSchema } from '../../../shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { AuthoringToolFailure } from './executeAuthoringTool'
import { decodeDynamicPackageFiles, dynamicPackageFilesSchema, parseDecodedDynamicPackageCandidate } from './dynamicPackageCandidate'
import { validateCourseProjectArchiveData } from '../../project/courseProjectArchive'
import { planAssetFileHistoryChange, type HistoryResourceState } from '../../store/courseResourceState'
import { collectPublishedCourseSourceIssues } from '../../export/course/buildPublishedCourse'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { collectCourseProjectInteractionHealth } from '../../../shared/courseProjectHealth/interaction'

// Existing unrelated errors remain diagnostics, not a new edit-wide gate.
// Stable owner/rule/action ids prevent list reordering from creating new errors.
function interactionErrorKey(project: CourseProjectDocument, finding: ReturnType<typeof collectCourseProjectInteractionHealth>[number]): string {
  let value: unknown = project
  const path = finding.path.map(segment => {
    const child = value != null && typeof value === 'object' ? (value as Record<string | number, unknown>)[segment] : undefined
    const identity = typeof segment === 'number' && child && typeof child === 'object'
      ? (child as { id?: string; layerItemId?: string }).id ?? (child as { layerItemId?: string }).layerItemId
      : undefined
    value = child
    return identity === undefined ? segment : { id: identity }
  })
  return JSON.stringify([finding.code, path, finding.message])
}

const artifact = z.object({
  document: courseProjectDocumentSchema,
  assetFiles: z.record(z.string(), z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)).optional(),
  componentFiles: z.record(z.string(), dynamicPackageFilesSchema).optional(),
}).strict()

/** An offline result is data for the existing transaction owner, never a live writer. */
export const projectDocumentTool: AuthoringToolDefinition<{ artifact: z.infer<typeof artifact> }> = {
  name: 'project.document', usesResources: true,
  inputSchema: z.object({ artifact }).strict(),
  description: 'CLI 文件兜底：读取本轮 resources/project/document.json，用原生脚本任意编辑其 V9 内容，保留工程 id 和基线 revision。把 {document:修改后的完整V9文档,assetFiles?:{素材ID:base64},componentFiles?:{包ID:{相对文件名:base64或{encoding:"utf8",text:"源码"}}}} 写入当前 resources/result.json。候选 input={artifact:{$candidateFile:"resources/result.json"}}，destination 使用本轮任意有效目标别名作为版本锚点，不限制修改对象。未提供的资源从当前工程复用；新增/替换资源必须真实提供并更新 document 元数据。新增第二个或更多 Surface 时，document 必须同时提供 mixedPrintPlan：每个 Surface 恰有一项，且 Slide 用 slide-scenes、Flow 用 flow-document、Spatial 用 spatial-frames。每个已存储的 global/surface/scene/world 图层列表内部按 item.order 严格递增；不要跨 owner 比较 order。Flow 的 backgroundColor 只能是六位 #RRGGBB（例如 #f8fafc）。宿主严格解析、检查资源闭包、为动态内容执行实际准入，并在一次工程/资源/历史事务中提交；不直接覆盖磁盘工程。只在当前工作副本操作，不依赖本机仓库源码或其他工程。',
  async plan({ document, value, resources, signal }) {
    if (!resources) throw new Error('工程制品缺少当前资源')
    const next = value.artifact.document
    if (next.id !== document.id || next.revision !== document.revision) throw new AuthoringToolFailure([{ code: 'artifact-baseline-conflict', path: ['input', 'artifact', 'document', next.id !== document.id ? 'id' : 'revision'], message: '完整制品基线与当前准备状态不一致。将本阶段全部修改合入一份原始基线制品单独提交，或使用快捷组合；不要改 revision 覆盖前序结果。' }])
    const assetFiles = Object.fromEntries(Object.keys(next.assets).map(id => [id,
      Object.hasOwn(value.artifact.assetFiles ?? {}, id) ? Uint8Array.from(atob(value.artifact.assetFiles![id]!), char => char.charCodeAt(0)) : resources.assetFiles[id]!]))
    const componentPackages = Object.fromEntries(Object.keys(next.componentPackages).map(id => [id,
      Object.hasOwn(value.artifact.componentFiles ?? {}, id) ? parseDecodedDynamicPackageCandidate(decodeDynamicPackageFiles(value.artifact.componentFiles![id]!)) : resources.componentPackages[id]!]))
    for (const id of Object.keys(value.artifact.assetFiles ?? {})) if (!next.assets[id]) throw new Error(`制品素材未登记：${id}`)
    for (const id of Object.keys(value.artifact.componentFiles ?? {})) if (!next.componentPackages[id]) throw new Error(`制品组件未登记：${id}`)
    if (Object.values(componentPackages).some(data => !data)) throw new Error('制品缺少组件文件')
    const nextResources: HistoryResourceState = { assetFiles, componentPackages }
    validateCourseProjectArchiveData({ project: next, assetFiles,
      componentFiles: Object.fromEntries(Object.entries(componentPackages).map(([id, data]) => [id, data.files])) })
    const previousInteractionErrors = new Set(collectCourseProjectInteractionHealth(document, {
      assetFiles: resources.assetFiles,
      componentFiles: Object.fromEntries(Object.entries(resources.componentPackages).map(([id, data]) => [id, data.files])),
    }).filter(finding => finding.severity === 'error').map(finding => interactionErrorKey(document, finding)))
    const interactionErrors = collectCourseProjectInteractionHealth(next, {
      assetFiles,
      componentFiles: Object.fromEntries(Object.entries(componentPackages).map(([id, data]) => [id, data.files])),
    }).filter(finding => finding.severity === 'error' && !previousInteractionErrors.has(interactionErrorKey(next, finding)))
    if (interactionErrors.length) throw new AuthoringToolFailure(interactionErrors.map(finding => ({
      code: finding.code, path: ['input', 'artifact', 'document', ...finding.path.map(String)], message: finding.message,
    })))
    const issues = collectPublishedCourseSourceIssues({ project: next, assetFiles, components: componentPackages })
    if (issues.length) throw new AuthoringToolFailure(issues.map(issue => ({ ...issue, path: issue.path.map(String) })))
    const assetFileChanges = [...new Set([...Object.keys(resources.assetFiles), ...Object.keys(assetFiles)])]
      .flatMap(id => { const change = planAssetFileHistoryChange(id, resources.assetFiles[id], assetFiles[id]); return change ? [change] : [] })
    const componentPackageChanges = [...new Set([...Object.keys(resources.componentPackages), ...Object.keys(componentPackages)])]
      .filter(id => resources.componentPackages[id] !== componentPackages[id])
      .map(packageId => ({ packageId, before: resources.componentPackages[packageId], after: componentPackages[packageId] }))
    const changed = JSON.stringify(next) !== JSON.stringify(document) || assetFileChanges.length > 0 || componentPackageChanges.length > 0
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    if (changed) {
      const targets = projectDynamicTargets(next, document, assetFileChanges.length > 0 || componentPackageChanges.length > 0)
      if (targets.length) await admitDynamicCandidate(next, nextResources, targets, signal, false,
        { onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence) })
    }
    return { transaction: { projectId: document.id, baseRevision: document.revision,
      nextDocument: changed ? { ...next, revision: document.revision + 1, updatedAt: new Date().toISOString() } : document,
      resourceChanges: { assetFileChanges, componentPackageChanges } },
      affected: changed ? [{ id: document.id, operation: 'updated', ownerKey: 'global', authoringAddress: null }] : [], behaviorEvidence }
  },
}

/** Include hidden/disabled instances and named states in the existing admission host. */
export function projectDynamicTargets(project: CourseProjectDocument, before: CourseProjectDocument, resourcesChanged: boolean) {
  const previous = new Map<string, unknown>(), changed = new Set<string>()
  const scan = (value: unknown, baseline: boolean, path = ''): void => {
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, any>
    if (node.kind === 'runtime' || node.kind === 'component' || node.type === 'component') {
      const id = node.layerItemId ?? node.id
      const identity = { path, node }
      if (baseline) previous.set(id, identity)
      else if (resourcesChanged || JSON.stringify(previous.get(id)) !== JSON.stringify(identity)) changed.add(id)
      return
    }
    Object.entries(node).forEach(([key, value]) => scan(value, baseline, `${path}/${key}`))
  }
  scan(before, true); scan(project, false)
  const ids = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return []
    const node = value as Record<string, any>
    if (node.kind === 'runtime' || node.kind === 'component') return [node.layerItemId]
    if (node.type === 'component') return [node.id]
    return Object.values(node).flatMap(ids)
  }
  return project.locations.flatMap(location => {
    const surface = project.surfaces.find(entry => entry.id === location.surfaceId)!
    const scene = surface.type === 'slide' && location.kind === 'slide-scene' ? surface.scenes.find(entry => entry.id === location.sceneId) : undefined
    const priorSurface = before.surfaces.find(entry => entry.id === surface.id)
    const priorScene = priorSurface?.type === 'slide' ? priorSurface.scenes.find(entry => entry.id === scene?.id) : undefined
    const geometry = (value: typeof surface | undefined) => value?.type === 'flow' ? value.layout : value?.type === 'slide' ? value.canvas : value?.type === 'spatial-2d' ? value.camera : null
    const layoutChanged = JSON.stringify(geometry(surface)) !== JSON.stringify(geometry(priorSurface))
      || JSON.stringify(scene?.presentation) !== JSON.stringify(priorScene?.presentation)
      || (surface.type === 'flow' && JSON.stringify(surface.blocks) !== JSON.stringify(priorSurface?.type === 'flow' ? priorSurface.blocks : undefined))
    const instanceIds = [...new Set([...ids(project.globalLayerItems), ...ids(surface.surfaceLayerItems),
      ...ids(surface.type === 'flow' ? surface.blocks : surface.type === 'spatial-2d' ? surface.world : scene?.layerItems)])]
      .filter(id => layoutChanged || changed.has(id))
    if (!instanceIds.length) return []
    const states = scene?.presentation?.states.map(state => state.id) ?? []
    return (states.length ? states : [null]).map(stateId => ({ locationId: location.id, stateId, instanceIds }))
  })
}
