import { z } from 'zod'
import { planRuntimeSourceUpdate } from '../../runtime/runtimeSourceAuthoringCommands'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.object({ source: z.string().min(1).max(2_000_000) }).strict()
export const runtimeSourceTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'runtime.source', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources }) {
    if (destination.kind !== 'update') throw new Error('Runtime 源码需要精确 update target')
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    const { target } = resolveAuthoringToolScope(document, destination)
    const result = planRuntimeSourceUpdate({ project: document, target: destination.target, source: value.source, now: new Date().toISOString(),
      currentIdentity: { projectId: document.id, documentRevision: document.revision,
        sessionToken: { locationId: target.locationId, surfaceType: target.surfaceType, revision: document.revision, generation: target.sessionGeneration },
        surfaceId: target.surfaceId, stateId: target.stateId, owner: target.owner, ownerKey: target.ownerKey } })
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    await admitDynamicCandidate(result.plan.nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }])
    return { transaction: { ...result.plan, selectionHint: undefined },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }],
      diagnostics: [{ code: 'dynamic-admitted', message: `Runtime ${destination.target.authoringAddress} 已通过 Published 闭包与真实宿主准入`, path: ['destination', 'target'] }] }
  },
}
