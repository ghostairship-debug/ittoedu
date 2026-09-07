import { z } from 'zod'
import { makeAuthoringAddress } from '../../../shared/authoringAddress'
import { componentRegistryKey, componentRuntimeSourceIdentity } from '../../../shared/componentRegistryIdentity'
import { dynamicPackageFilesSchema, parseDynamicPackageCandidate } from './dynamicPackageCandidate'
import { planCourseComponentPackageReplacement } from '../../components/courseComponentPackageTransactions'
import { prepareComponentPackageSourceRevision, prepareComponentPackageRevision } from '../../components/componentPackageRevision'
import { resolveAuthoringToolScope } from './authoringToolScope'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('replace'), files: dynamicPackageFilesSchema }).strict(),
  z.object({ operation: z.literal('revise'), baseVersion: z.string().min(1), baseContentIdentity: z.string().regex(/^[a-f0-9]{64}$/), files: dynamicPackageFilesSchema }).strict(),
])
export const componentPackageAddress = (projectId: string, packageId: string) => makeAuthoringAddress({ projectId, scope: 'global', carrier: 'component', layerItemId: packageId, field: 'componentPackages' })

export const componentPackageTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.package', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources, signal }) {
    const { target } = resolveAuthoringToolScope(document, destination)
    if (destination.kind !== 'update' || target.owner !== 'global' || destination.target.authoringAddress !== componentPackageAddress(document.id, destination.target.itemId)) throw new Error('组件包替换需要精确 global package target')
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    const replacement = parseDynamicPackageCandidate(value.files)
    const packageId = destination.target.itemId
    const result = value.operation === 'revise'
      ? await prepareComponentPackageSourceRevision({ project: document, resources,
          baseline: { packageId, projectId: document.id, documentRevision: document.revision,
            baseVersion: value.baseVersion, baseContentIdentity: value.baseContentIdentity },
          files: replacement.files, operationId: crypto.randomUUID() }, signal)
      : await prepareComponentPackageRevision(planCourseComponentPackageReplacement({ project: document,
          componentPackages: resources.componentPackages, packageId, replacement,
          expected: { projectId: document.id, revision: document.revision }, now: new Date().toISOString() }), resources, packageId, signal)
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    const admitted = result.plan.resourceChanges.componentPackageChanges?.find(change => change.packageId === packageId)?.after ?? replacement
    const identity = componentRegistryKey({ projectId: document.id, packageId, version: admitted.manifest.version,
      sourceIdentity: componentRuntimeSourceIdentity(admitted.runtimeSource), contentIdentity: admitted.contentSha256! })
    return { transaction: result.plan, affected: [{ id: packageId, operation: 'updated', ownerKey: 'global', authoringAddress: destination.target.authoringAddress }],
      diagnostics: [{ code: 'dynamic-admitted', message: identity, path: ['componentPackages', packageId] }] }
  },
}
