import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { componentRegistryKey, componentRuntimeSourceIdentity } from '../../../shared/componentRegistryIdentity'
import { dynamicPackageFilesSchema, parseDynamicPackageCandidate, decodeDynamicPackageFiles, parseDecodedDynamicPackageCandidate } from './dynamicPackageCandidate'
import { planCourseComponentPackageReplacement } from '../../components/courseComponentPackageTransactions'
import { prepareComponentPackageSourceRevision, prepareComponentPackageRevision, planComponentPackageSourceRevision, planComponentPackageFork, assertComponentPackageSourceBaseline, captureComponentPackageSourceBaseline } from '../../components/componentPackageRevision'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import { editableComponentPackageId, rewriteComponentDefinitionId } from '../../components/editableComponentPackage'
import { applyHistoryResourceChanges } from '../../store/courseResourceState'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { resolveEffectiveLayerTarget } from '../../course/effectiveLayerCommands'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('replace'), files: dynamicPackageFilesSchema }).strict(),
  z.object({ operation: z.literal('revise'), baseVersion: z.string().min(1), baseContentIdentity: z.string().regex(/^[a-f0-9]{64}$/), files: dynamicPackageFilesSchema }).strict(),
  z.object({ operation: z.literal('patch'), mode: z.enum(['shared', 'instance']), basePackageId: z.string().min(1),
    baseVersion: z.string().min(1), baseContentIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    changedFiles: dynamicPackageFilesSchema, deleteFiles: z.array(z.string().min(1).max(500)).max(512) }).strict()
    .refine(value => Object.keys(value.changedFiles).length > 0 || value.deleteFiles.length > 0, '源码增量至少改变或删除一个文件'),
])
export const componentPackageAddress = (projectId: string, packageId: string) => makeAuthoringAddress({ projectId, scope: 'global', carrier: 'component', layerItemId: packageId, field: 'componentPackages' })

export const componentPackageTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.package', inputSchema: schema, usesResources: true,
  description: '修改现有源码优先 patch：提供精确 basePackageId/baseVersion/baseContentIdentity、仅改变的 changedFiles、显式 deleteFiles；宿主补齐未变文件并校验完整包。mode:shared 使用 global package update target 修改所有实例；mode:instance 使用精确组件实例 update target，宿主另存副本仅重绑此实例。不得自行改 manifest ID/版本。公开参数足够时用 component.configure；完整 files revise 保持兼容。',
  async plan({ document, destination, value, resources, signal }) {
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    if (destination.kind !== 'update') throw new Error('组件源码修订需要精确 update target')
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    const instanceMode = value.operation === 'patch' && value.mode === 'instance'
    let packageId = value.operation === 'patch' ? value.basePackageId : destination.target.itemId
    if (instanceMode) {
      const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId) : null
      if (body) {
        if (body.block.type !== 'component' || body.block.component.packageId !== packageId || destination.target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: 'component' })) throw new Error('实例另存的正文目标与组件包不一致')
      } else {
        const located = resolveEffectiveLayerTarget(document, destination.target)
        if (located.item.kind !== 'component' || located.item.layerItemId !== destination.target.itemId || located.item.component.packageId !== packageId || located.source !== scope.owner
          || located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) throw new Error('实例另存的图层目标与组件包或 owner 不一致')
        if (located.item.locked) throw new Error('图层已锁定，不能另存实例源码')
      }
      if (target.stateId !== null) throw new Error('组件包身份属于实例基础层，命名状态不能单独重绑组件包；请选择基础状态实例另存')
    } else if (target.owner !== 'global' || destination.target.itemId !== packageId || destination.target.authoringAddress !== componentPackageAddress(document.id, packageId)) throw new Error('共享组件源码修订需要精确 global package target')
    let replacement
    if (value.operation === 'patch') {
      assertComponentPackageSourceBaseline(document, { packageId, baseVersion: value.baseVersion, baseContentIdentity: value.baseContentIdentity, projectId: document.id, documentRevision: document.revision })
      const original = resources.componentPackages[packageId]
      if (!original || original.manifest.id !== packageId || original.manifest.version !== value.baseVersion || componentContentSha256(original.files) !== value.baseContentIdentity) throw new Error('stale：当前完整组件源码与增量基线不一致')
      const files = { ...original.files, ...decodeDynamicPackageFiles(value.changedFiles) }
      if (new Set(value.deleteFiles).size !== value.deleteFiles.length) throw new Error('删除文件不能重复')
      for (const path of value.deleteFiles) {
        if (!Object.hasOwn(original.files, path) || Object.hasOwn(value.changedFiles, path)) throw new Error('删除文件必须存在于基线且不能同时修改')
        delete files[path]
      }
      replacement = parseDecodedDynamicPackageCandidate(files)
      if (replacement.manifest.id !== packageId || replacement.manifest.version !== value.baseVersion) throw new Error('源码增量不得修改组件包 ID 或版本')
    } else replacement = parseDynamicPackageCandidate(value.files)
    let result
    const behaviorEvidence: DynamicBehaviorObservation[] = [], collectEvidence = (values: readonly DynamicBehaviorObservation[]) => behaviorEvidence.push(...values)
    if (instanceMode) {
      const nextId = editableComponentPackageId(packageId, crypto.randomUUID())
      const fork = planComponentPackageFork(document, resources.componentPackages, packageId, nextId, destination.target.itemId)
      const forkResources = applyHistoryResourceChanges(resources, fork.resourceChanges, 'forward')
      const manifest = { ...replacement.manifest, id: nextId, version: forkResources.componentPackages[nextId]!.manifest.version }
      const files = { ...replacement.files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
        [manifest.entry]: new TextEncoder().encode(rewriteComponentDefinitionId(replacement.runtimeSource, packageId, nextId)) }
      const revised = planComponentPackageSourceRevision({ project: fork.nextDocument, resources: forkResources,
        baseline: captureComponentPackageSourceBaseline(fork.nextDocument, nextId), files, operationId: crypto.randomUUID() })
      if (!revised.ok) throw new Error(revised.reason)
      const staged = revised.status === 'planned' ? revised.plan : fork
      const after = revised.status === 'planned' ? revised.plan.resourceChanges.componentPackageChanges?.find(change => change.packageId === nextId)?.after : forkResources.componentPackages[nextId]
      if (!after) throw new Error('实例另存没有完整源码结果')
      const combined = { projectId: document.id, baseRevision: document.revision, nextDocument: { ...staged.nextDocument, revision: document.revision + 1 },
        resourceChanges: { componentPackageChanges: [{ packageId: nextId, after }] } }
      result = await prepareComponentPackageRevision({ ok: true, status: 'planned', plan: combined }, resources, nextId, signal, collectEvidence)
      packageId = nextId
    } else result = value.operation === 'revise' || value.operation === 'patch'
      ? await prepareComponentPackageSourceRevision({ project: document, resources,
          baseline: { packageId, projectId: document.id, documentRevision: document.revision,
            baseVersion: value.baseVersion, baseContentIdentity: value.baseContentIdentity },
          files: replacement.files, operationId: crypto.randomUUID() }, signal, collectEvidence)
      : await prepareComponentPackageRevision(planCourseComponentPackageReplacement({ project: document,
          componentPackages: resources.componentPackages, packageId, replacement,
          expected: { projectId: document.id, revision: document.revision }, now: new Date().toISOString() }), resources, packageId, signal, collectEvidence)
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    const admitted = result.plan.resourceChanges.componentPackageChanges?.find(change => change.packageId === packageId)?.after ?? replacement
    const identity = componentRegistryKey({ projectId: document.id, packageId, version: admitted.manifest.version,
      sourceIdentity: componentRuntimeSourceIdentity(admitted.runtimeSource), contentIdentity: admitted.contentSha256! })
    return { transaction: result.plan, affected: instanceMode ? [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress },
      { id: packageId, operation: 'created', ownerKey: 'global', authoringAddress: componentPackageAddress(document.id, packageId) }]
      : [{ id: packageId, operation: 'updated', ownerKey: 'global', authoringAddress: destination.target.authoringAddress }],
      diagnostics: [{ code: 'dynamic-admitted', message: identity, path: ['componentPackages', packageId] }], ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
  },
}
