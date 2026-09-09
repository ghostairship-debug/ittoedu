import { z } from 'zod'
import { resolveEffectiveLayerTarget, patchEffectiveLayerPropertiesAtTarget } from '../../course/effectiveLayerCommands'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { updateFlowDocumentComponentBlock } from '../../course/flowSharedAuthoringAdapters'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate, verifyDynamicCandidateBehavior } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'
import { layerItemPropertiesInputSchema } from './layerItemPropertiesInput'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { applyComponentVariant, getComponentPropValue, mergeComponentProps, resolveComponentEditorProperties } from '../../../shared/componentProps'
import type { ComponentManifest } from '../../../shared/componentTypes'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'

/** Public parameter descriptors are the existing editor contract, not a new props schema. */
function validatePublicProps(project: CourseProjectDocument, manifest: ComponentManifest | undefined, before: Record<string, unknown>, after: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  if (!manifest) throw new Error('组件公开参数缺少正式 manifest')
  const descriptors = new Map(resolveComponentEditorProperties(manifest, before).map(property => [property.key, property]))
  const effective = mergeComponentProps(manifest, after)
  let publicOnly = true
  const visit = (value: unknown, path: string) => {
    const property = descriptors.get(path)
    if (!property && value && typeof value === 'object') { Object.entries(value).forEach(([key, child]) => visit(child, path ? `${path}.${key}` : key)); return }
    if (!property) { publicOnly = false; return }
    const current = getComponentPropValue(effective, path)
    if ((current === undefined || current === null || current === '') && !property.required) return
    const valid = property.type === 'text' || property.type === 'textarea' ? typeof current === 'string' && (!property.required || current.length > 0) && (property.maxLength === undefined || current.length <= property.maxLength)
      : property.type === 'number' ? typeof current === 'number' && Number.isFinite(current) && (property.min === undefined || current >= property.min) && (property.max === undefined || current <= property.max)
      : property.type === 'boolean' ? typeof current === 'boolean'
      : property.type === 'color' ? typeof current === 'string' && /^#[0-9a-fA-F]{6}$/.test(current)
      : property.type === 'select' ? property.options.some(option => option.value === current)
      : typeof current === 'string' && project.assets[current]?.kind === 'image'
    if (!valid) throw new Error(`组件公开参数 ${path} 不符合 ${property.type} 合同`)
  }
  Object.entries(patch).forEach(([key, value]) => visit(value, key))
  return publicOnly
}

const schema = z.object({ props: z.record(z.string(), z.unknown()).optional(), properties: layerItemPropertiesInputSchema.optional() }).strict()
  .refine(value => value.props !== undefined || value.properties !== undefined, '组件配置至少提供props或properties')
export const componentConfigureTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.configure', inputSchema: schema, usesResources: true,
  description: '配置已有或前序新建组件，carrier均为existing-component。props只提供要改变的参数，保留当前有效状态中未提供的参数，API 4 的 content 按正式递归合并合同保留其他文案。properties修改组件图层的frame/rotation/opacity/visible/locked/label。Flow正文组件只接受props，其排版通过flow.content。不要用native.content移动组件。',
  async plan({ document, destination, value, resources, signal }) {
    if (destination.kind !== 'update' || !resources) throw new Error('组件配置需要精确 update target 与当前工程资源')
    const { target, surface, scope } = resolveAuthoringToolScope(document, destination)
    const body = surface.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, destination.target.itemId) : null
    let nextDocument
    let publicOnly = false
    if (body) {
      if (value.properties) throw new Error('Flow 正文组件排版需要 flow.content，不接受图层 properties')
      if (body.block.type !== 'component' || destination.target.authoringAddress !== makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: body.block.id, carrier: 'component' })) throw new Error('正文组件 target 不匹配')
      const manifest = resources.componentPackages[body.block.component.packageId]?.manifest
      const props = applyComponentVariant(body.block.props, { id: 'semantic-edit', label: '参数编辑', props: value.props! }, manifest)
      publicOnly = validatePublicProps(document, manifest, body.block.props, props, value.props!)
      const result = updateFlowDocumentComponentBlock(document, { ...selectFlowEditorBlock(document, target.locationId, body.block.id), authoringScope: 'page' }, { props })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    } else {
      const located = resolveEffectiveLayerTarget(document, destination.target)
      if (located.item.kind !== 'component' || located.item.layerItemId !== destination.target.itemId || located.source !== scope.owner) throw new Error('组件 target 身份或 owner 不匹配')
      if (located.source !== 'global' && (located.surfaceId !== surface.id || located.source === 'scene' && located.sceneId !== scope.sceneId)) throw new Error('组件 target 不属于当前 Surface / scene')
      const effective = projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === located.item.layerItemId)?.item
      if (effective?.kind !== 'component') throw new Error('组件有效状态已失效')
      const manifest = resources.componentPackages[effective.component.packageId]?.manifest
      const props = value.props ? applyComponentVariant(effective.props, { id: 'semantic-edit', label: '参数编辑', props: value.props }, manifest) : undefined
      if (props) publicOnly = validatePublicProps(document, manifest, effective.props, props, value.props!)
      const result = patchEffectiveLayerPropertiesAtTarget(document, destination.target, { ...value.properties, ...(props ? { componentProps: props } : {}) })
      if (!result.ok || !result.nextDocument) throw new Error(result.reason)
      nextDocument = result.nextDocument
    }
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    // Wrapper-only edits do not execute or re-admit unchanged component code.
    if (value.props && nextDocument.revision !== document.revision) {
      const targets = [{ locationId: target.locationId, stateId: target.stateId, instanceIds: [destination.target.itemId] }]
      if (publicOnly) behaviorEvidence.push(...await verifyDynamicCandidateBehavior(nextDocument, resources, targets, signal))
      else await admitDynamicCandidate(nextDocument, resources, targets, signal, false, { onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence) })
    }
    return { transaction: { projectId: document.id, baseRevision: document.revision, nextDocument, resourceChanges: {},
      selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
        ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}), itemIds: [destination.target.itemId] } },
      affected: [{ id: destination.target.itemId, operation: 'updated', ownerKey: target.ownerKey, authoringAddress: destination.target.authoringAddress }], ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
  },
}
