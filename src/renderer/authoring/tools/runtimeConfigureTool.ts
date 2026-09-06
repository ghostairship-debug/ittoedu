import { z } from 'zod'
import { planRuntimePropertyUpdate } from '../../runtime/runtimePropertyAuthoringCommands'
import { planRuntimeContentTextUpdate } from '../../runtime/runtimeContentTextAuthoringCommands'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const modes = z.enum(['dom', 'phaser', 'hybrid'])
const schema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('enabled'), initialValue: z.boolean(), value: z.boolean() }).strict(),
  z.object({ field: z.literal('renderMode'), initialValue: modes, value: modes }).strict(),
  z.object({ field: z.literal('content'), contentKey: z.string().min(1), initialValue: z.string(), value: z.string() }).strict(),
])

export const runtimeConfigureTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'runtime.configure', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources }) {
    if (destination.kind !== 'update' || !resources) throw new Error('Runtime 配置需要精确 update target 与当前工程资源')
    const { target } = resolveAuthoringToolScope(document, destination)
    const currentIdentity = { projectId: document.id, documentRevision: document.revision,
      sessionToken: { locationId: target.locationId, surfaceType: target.surfaceType, revision: document.revision, generation: target.sessionGeneration },
      surfaceId: target.surfaceId, stateId: target.stateId, owner: target.owner, ownerKey: target.ownerKey }
    const common = { project: document, currentIdentity, now: new Date().toISOString() }
    const result = value.field === 'content'
      ? planRuntimeContentTextUpdate({ ...common, target: { courseTarget: destination.target, contentKey: value.contentKey, initialValue: value.initialValue }, value: value.value })
      : planRuntimePropertyUpdate({ ...common, target: value.field === 'enabled'
        ? { courseTarget: destination.target, field: 'enabled', initialValue: value.initialValue }
        : { courseTarget: destination.target, field: 'renderMode', initialValue: value.initialValue },
      update: value.field === 'enabled' ? { field: 'enabled', value: value.value } : { field: 'renderMode', value: value.value } })
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    // Turning execution off is also how authors recover from existing bad code.
    // It introduces no executable candidate and must not require that code to run.
    if (value.field !== 'enabled' || value.value) await admitDynamicCandidate(result.plan.nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }])
    return { transaction: { ...result.plan, selectionHint: undefined },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }] }
  },
}
