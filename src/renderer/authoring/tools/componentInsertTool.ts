import { z } from 'zod'
import { planComponentPackageInsertion } from '../../components/insertComponentPackages'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { openSpatialAuthoringSession } from '../../course/spatialEditorCommands'
import { createFlowEditorHistory, selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { applyHistoryResourceChanges } from '../../store/courseResourceState'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { makeFlowBlockAuthoringAddress } from '../../course/flowDocumentModel'
import { dynamicPackageFilesSchema, parseDynamicPackageCandidate } from './dynamicPackageCandidate'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('existing'), packageId: z.string().min(1), staticFallbackAssetId: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('candidate'), files: dynamicPackageFilesSchema, staticFallbackAssetId: z.string().min(1) }).strict(),
])
export const componentInsertTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.insert', inputSchema: schema, usesResources: true,
  async plan({ document, destination, value, resources }) {
    const { target, surface, location, scope } = resolveAuthoringToolScope(document, destination)
    if (!resources) throw new Error('组件工具缺少当前工程资源')
    if (destination.kind !== 'create' || destination.scope.insertion.kind !== 'append') throw new Error('组件插入需要追加 create scope')
    const body = surface.type === 'flow' && target.owner === 'surface' && destination.scope.parent.kind === 'flow-body'
    if (body ? destination.scope.parent.kind !== 'flow-body' || destination.scope.parent.parentBlockId !== null : destination.scope.parent.kind !== 'owner') throw new Error('组件插入父 scope 不匹配')
    if (surface.type === 'spatial-2d' && target.owner !== 'world') throw new Error('Spatial 组件插入需要 world owner')
    const data = value.operation === 'candidate' ? parseDynamicPackageCandidate(value.files) : resources.componentPackages[value.packageId]
    if (!data || value.operation === 'existing' && !document.componentPackages[value.packageId]) throw new Error('工程内组件包不存在')
    const slideBase = surface.type === 'slide' ? openSlideAuthoringSession(document, { locationId: target.locationId }) : null
    const planned = planComponentPackageInsertion({ document, componentPackages: resources.componentPackages, packages: [data],
      staticFallbackAssetId: value.staticFallbackAssetId, flowPlacement: body ? 'document-block' : 'viewport-overlay',
      target: { projectId: document.id, revision: document.revision, generation: target.sessionGeneration, locationId: target.locationId, stateId: target.stateId, scope: target.owner },
      slide: slideBase ? { ...slideBase, scope: target.owner === 'global' ? 'global' : 'scene', selection: { ...slideBase.selection, stateId: target.stateId } } : null,
      spatial: surface.type === 'spatial-2d' ? openSpatialAuthoringSession(document, { locationId: target.locationId }) : null,
      flow: location.kind === 'flow-block' && surface.type === 'flow' ? { history: createFlowEditorHistory(document), selection: { ...selectFlowEditorBlock(document, target.locationId, body ? surface.blocks.at(-1)!.id : location.blockId), authoringScope: target.owner === 'global' ? 'global' : 'page' } } : null,
    })
    if (value.operation === 'candidate') await admitDynamicCandidate(planned.step.nextDocument, applyHistoryResourceChanges(resources, planned.step.resourceChanges, 'forward'), [{ locationId: target.locationId, stateId: target.stateId, instanceIds: planned.layerItemIds }])
    return { transaction: { ...planned.step, selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
      ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}), itemIds: planned.layerItemIds } },
      affected: planned.layerItemIds.map(id => ({ id, operation: 'created' as const, ownerKey: target.ownerKey,
        authoringAddress: body ? makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: id, carrier: 'component' })
          : makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: 'component', layerItemId: id }) })) }
  },
}
