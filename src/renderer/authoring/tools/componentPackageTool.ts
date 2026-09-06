import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { componentRegistryKey, componentRuntimeSourceIdentity } from '../../../shared/componentRegistryIdentity'
import { dynamicPackageFilesSchema, parseDynamicPackageCandidate } from './dynamicPackageCandidate'
import { collectCourseComponentPackageReferences, planCourseComponentPackageReplacement } from '../../components/courseComponentPackageTransactions'
import { applyHistoryResourceChanges } from '../../store/courseResourceState'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ operation: z.literal('replace'), files: dynamicPackageFilesSchema }).strict()
export const componentPackageAddress = (projectId: string, packageId: string) => makeAuthoringAddress({ projectId, scope: 'global', carrier: 'component', layerItemId: packageId, field: 'componentPackages' })

export const componentPackageTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.package', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources, signal }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (destination.kind !== 'update' || target.owner !== 'global' || destination.target.authoringAddress !== componentPackageAddress(document.id, destination.target.itemId)) throw new Error('组件包替换需要精确 global package target')
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    const replacement = parseDynamicPackageCandidate(value.files)
    const packageId = destination.target.itemId
    const result = planCourseComponentPackageReplacement({ project: document, componentPackages: resources.componentPackages, packageId, replacement,
      expected: { projectId: document.id, revision: document.revision }, now: new Date().toISOString() })
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    const refs = collectCourseComponentPackageReferences(result.plan.nextDocument, packageId)
    const locations = result.plan.nextDocument.locations.filter(location => refs.some(ref => ref.carrier === 'global-layer'
      || ref.surfaceId === location.surfaceId && (!ref.sceneId || location.kind === 'slide-scene' && ref.sceneId === location.sceneId)))
    if (!locations.length) throw new Error('组件源码准入需要工程内实际实例')
    await admitDynamicCandidate(result.plan.nextDocument, applyHistoryResourceChanges(resources, result.plan.resourceChanges, 'forward'), locations.flatMap(location => {
      const surface = result.plan.nextDocument.surfaces.find(entry => entry.id === location.surfaceId)
      const states = surface?.type === 'slide' && location.kind === 'slide-scene'
        ? surface.scenes.find(entry => entry.id === location.sceneId)?.presentation?.states.map(state => state.id) ?? [] : []
      const instanceIds = refs.filter(ref => ref.carrier === 'global-layer' || ref.surfaceId === location.surfaceId && (!ref.sceneId || location.kind === 'slide-scene' && ref.sceneId === location.sceneId)).map(ref => ref.instanceId)
      return (states.length ? states : [null]).map(stateId => ({ locationId: location.id, stateId, instanceIds }))
    }), signal)
    const identity = componentRegistryKey({ projectId: document.id, packageId, version: replacement.manifest.version,
      sourceIdentity: componentRuntimeSourceIdentity(replacement.runtimeSource), contentIdentity: replacement.contentSha256! })
    return { transaction: result.plan, affected: [{ id: packageId, operation: 'updated', ownerKey: 'global', authoringAddress: destination.target.authoringAddress }],
      diagnostics: [{ code: 'dynamic-admitted', message: identity, path: ['componentPackages', packageId] }] }
  },
}
