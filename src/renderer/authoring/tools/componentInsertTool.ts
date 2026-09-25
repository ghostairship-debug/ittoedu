import { z } from 'zod'
import { planComponentPackageInsertion } from '../../components/insertComponentPackages'
import { importComponentPackageAsync } from '../../../core/drivers/codecs/importComponentPackage'
import { openSlideAuthoringSession } from '../../course/slideAuthoringBackend'
import { openSpatialAuthoringSession } from '../../course/spatialEditorCommands'
import { createFlowEditorHistory, selectFlowEditorBlock } from '../../course/flowEditorSlice'
import { applyHistoryResourceChanges } from '../../store/courseResourceState'
import { makeLayerItemAuthoringAddress } from '../courseAuthoringScope'
import { findFlowBlockRecursive, makeFlowBlockAuthoringAddress } from '../../../core/tools/flowDocumentModel'
import { moveFlowEditorBlock } from '../../course/flowEditorCommands'
import { dynamicPackageFilesSchema, parseDynamicPackageCandidate } from './dynamicPackageCandidate'
import { resolveAuthoringToolScope } from './authoringToolScope'
import { admitDynamicCandidate } from './dynamicCandidateAdmission'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import type { AuthoringToolDefinition } from './executeAuthoringTool'

const schema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('existing'), packageId: z.string().min(1), staticFallbackAssetId: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('catalog'), sourceId: z.string().min(1), packageId: z.string().min(1), version: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), staticFallbackAssetId: z.string().min(1).optional() }).strict(),
  z.object({ operation: z.literal('candidate'), files: dynamicPackageFilesSchema, staticFallbackAssetId: z.string().min(1) }).strict(),
])
export const componentInsertTool: AuthoringToolDefinition<z.infer<typeof schema>> = {
  name: 'component.insert', inputSchema: schema, usesResources: true,
  conditions: [{ destination: 'create', parents: ['owner', 'flow-body'], requiredForParent: { parent: 'flow-body', field: 'staticFallbackAssetId' }, message: '组件插入使用 create；Flow 正文必须提供当前工程或前序导入的真实图片 staticFallbackAssetId。' }],
  description: '插入已有、目录或候选组件。目标使用 create；父级条件按目标计算：只有 Flow 正文 parent:flow-body 必须提供当前工程或前序导入的真实图片 staticFallbackAssetId，Slide、Flow 浮层和 Spatial world 不受该 Flow-only 条件约束。Spatial world 可使用 operation:candidate 提交 Component API 4 文件候选；candidate 输入仍须满足本卡完整 Schema。优先复用已有组件包与可用后备素材，正文组件自然占位并随内容宽度排版。',
  async plan({ document, destination, value, resources, signal }) {
    const { target, surface, location, scope } = resolveAuthoringToolScope(document, destination)
    if (!resources) throw new Error('组件工具缺少当前工程资源')
    if (destination.kind !== 'create' || destination.scope.insertion.kind !== 'append') throw new Error('组件插入需要追加 create scope')
    const body = surface.type === 'flow' && target.owner === 'surface' && destination.scope.parent.kind === 'flow-body'
    if (body ? destination.scope.parent.kind !== 'flow-body' : destination.scope.parent.kind !== 'owner') throw new Error('组件插入父 scope 不匹配')
    const parentBlockId = body && destination.scope.parent.kind === 'flow-body' ? destination.scope.parent.parentBlockId : null
    if (parentBlockId !== null && (surface.type !== 'flow' || findFlowBlockRecursive(surface.blocks, parentBlockId)?.block.type !== 'section')) throw new Error('组件插入父分节已失效')
    if (surface.type === 'spatial-2d' && target.owner !== 'world') throw new Error('Spatial 组件插入需要 world owner')
    let data = value.operation === 'candidate' ? parseDynamicPackageCandidate(value.files) : resources.componentPackages[value.packageId]
    if (value.operation === 'catalog') {
      const api = typeof window === 'undefined' ? undefined : window.desktopAPI
      if (!api?.loadComponentCatalog || !api.readComponentCatalogPackage) throw new Error('当前宿主不支持读取组件目录')
      const catalog = await api.loadComponentCatalog()
      const entry = catalog.packages.find(entry => entry.sourceId === value.sourceId && entry.packageId === value.packageId && entry.version === value.version)
      if (!entry || entry.sourceTrust === 'prompt' || entry.sha256 !== value.sha256) throw new Error('组件目录版本已改变或尚未受信，请刷新引用')
      if (signal?.aborted) throw new Error('组件读取已取消')
      const file = await api.readComponentCatalogPackage({ sourceId: entry.sourceId, packageId: entry.packageId, version: entry.version })
      if (file.sha256 !== entry.sha256 || file.sourceTrust === 'prompt') throw new Error('组件目录读取结果已改变，请刷新引用')
      data = await importComponentPackageAsync(file.bytes, { expectedId: entry.packageId, expectedVersion: entry.version,
        provenance: { sha256: file.sha256, importedAt: new Date().toISOString(), sourceLabel: entry.sourceLabel } })
    }
    if (!data || value.operation === 'existing' && !document.componentPackages[value.packageId]) throw new Error('工程内组件包不存在')
    const slideBase = surface.type === 'slide' ? openSlideAuthoringSession(document, { locationId: target.locationId }) : null
    const planned = planComponentPackageInsertion({ document, componentPackages: resources.componentPackages, packages: [data],
      staticFallbackAssetId: value.staticFallbackAssetId, flowPlacement: body ? 'document-block' : 'viewport-overlay',
      target: { projectId: document.id, revision: document.revision, generation: target.sessionGeneration, locationId: target.locationId, stateId: target.stateId, scope: target.owner },
      slide: slideBase ? { ...slideBase, scope: target.owner === 'global' ? 'global' : 'scene', selection: { ...slideBase.selection, stateId: target.stateId } } : null,
      spatial: surface.type === 'spatial-2d' ? openSpatialAuthoringSession(document, { locationId: target.locationId }) : null,
      flow: location.kind === 'flow-block' && surface.type === 'flow' ? { history: createFlowEditorHistory(document), selection: { ...selectFlowEditorBlock(document, target.locationId, body ? surface.blocks.at(-1)!.id : location.blockId), authoringScope: target.owner === 'global' ? 'global' : 'page' } } : null,
    })
    let nextDocument = planned.step.nextDocument
    if (parentBlockId !== null) for (const id of planned.layerItemIds) {
      const nextSurface = nextDocument.surfaces.find(entry => entry.id === surface.id)
      if (nextSurface?.type !== 'flow') throw new Error('正文表面已失效')
      const current = findFlowBlockRecursive(nextSurface.blocks, id), parent = findFlowBlockRecursive(nextSurface.blocks, parentBlockId)?.block
      if (!current || parent?.type !== 'section') throw new Error('正文组件插入位置已失效')
      const moved = moveFlowEditorBlock(nextDocument, { surfaceId: surface.id, parentId: current.parentId, blockId: id }, { parentId: parentBlockId, index: parent.blocks.length }, { expectedRevision: nextDocument.revision })
      if (!moved.ok || !moved.nextDocument) throw new Error(moved.reason)
      nextDocument = { ...moved.nextDocument, revision: document.revision + 1 }
    }
    const behaviorEvidence: DynamicBehaviorObservation[] = []
    if (value.operation === 'candidate') await admitDynamicCandidate(nextDocument, applyHistoryResourceChanges(resources, planned.step.resourceChanges, 'forward'), [{ locationId: target.locationId, stateId: target.stateId, instanceIds: planned.layerItemIds }], signal, false, { onBehaviorEvidence: evidence => behaviorEvidence.push(...evidence) })
    return { transaction: { ...planned.step, nextDocument, selectionHint: { kind: 'authoring-tool-selection', locationId: target.locationId, stateId: target.stateId, owner: target.owner,
      ...(surface.type === 'flow' ? { flowCarrier: body ? 'block' : 'overlay' } : {}), itemIds: planned.layerItemIds } },
      affected: planned.layerItemIds.map(id => ({ id, operation: 'created' as const, ownerKey: target.ownerKey,
        authoringAddress: body ? makeFlowBlockAuthoringAddress({ projectId: document.id, surfaceId: surface.id, blockId: id, carrier: 'component' })
          : makeLayerItemAuthoringAddress({ projectId: document.id, owner: target.owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: 'component', layerItemId: id }) })), ...(behaviorEvidence.length ? { behaviorEvidence } : {}) }
  },
}
