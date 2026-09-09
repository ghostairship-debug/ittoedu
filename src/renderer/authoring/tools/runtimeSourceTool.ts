import { z } from 'zod'
import { planRuntimeSourceUpdate } from '../../runtime/runtimeSourceAuthoringCommands'
import { resolveRuntimeToolTarget } from './runtimeToolTarget'
import { COURSE_RUNTIME_SOURCE_AUTHORING_FIELD } from '../../runtime/runtimeSourceAuthoringView'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { courseRuntimeDefinitionSchema } from '../../../shared/courseProjectSchema'

const schema = z.object({ source: z.string().min(1).max(2_000_000),
  staticFallback: courseRuntimeDefinitionSchema.shape.staticFallback }).strict()
export const runtimeSourceTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'runtime.source', inputSchema: schema, usesResources: true,
  description: '修改现有 Runtime 的完整 source，使用观察中该对象的原 update target；保留实例ID、位置、尺寸、绑定和未指定字段。省略 staticFallback 时保留原后备；需修复或更新后备图片时可同时指定 strict {assetId,coverage}（coverage 为 scene 或 surface），先经 asset.media.import 导入有效图片，再用其 asset-id 回执引用。source 与后备在同一事务更新；仅换后备时仍提供当前完整 source。速度或机制修改无需新建或 selection.replace，所有修改仍须完整资源闭包与真实宿主准入。',
  async plan({ document, destination, value, resources, signal }) {
    if (destination.kind !== 'update') throw new Error('Runtime 源码需要精确 update target')
    if (!resources) throw new Error('动态工具缺少当前工程资源')
    const { target, runtimeTarget } = resolveRuntimeToolTarget(document, destination, COURSE_RUNTIME_SOURCE_AUTHORING_FIELD)
    const result = planRuntimeSourceUpdate({ project: document, target: runtimeTarget, source: value.source,
      ...(value.staticFallback === undefined ? {} : { staticFallback: value.staticFallback }), now: new Date().toISOString(),
      currentIdentity: { projectId: document.id, documentRevision: document.revision,
        sessionToken: { locationId: target.locationId, surfaceType: target.surfaceType, revision: document.revision, generation: target.sessionGeneration },
        surfaceId: target.surfaceId, stateId: target.stateId, owner: target.owner, ownerKey: target.ownerKey } })
    if (!result.ok) throw new Error(result.reason)
    if (result.status === 'no-op') return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument: document, resourceChanges: {} }, affected: [] }
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    await admitDynamicCandidate(result.plan.nextDocument, resources, [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }], signal, false, { onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence) })
    return { transaction: { ...result.plan, selectionHint: undefined },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }],
      diagnostics: [{ code: 'dynamic-admitted', message: `Runtime ${destination.target.authoringAddress} 已通过 Published 闭包与真实宿主准入`, path: ['destination', 'target'] }], ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
  },
}
