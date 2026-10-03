import type { ComponentPackageData } from '../../shared/componentTypes'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import { createEditorTransactionStep } from '../authoring/editorTransaction'
import { addSlideComponentLayer } from '../course/v9SlideContentCommands'
import { addSpatialWorldComponentLayer } from '../course/spatialEditorCommands'
import { insertFlowSharedComponent, type FlowComponentInsertRequest } from '../course/flowSharedAuthoringAdapters'
import { componentPackageMeta } from '../../shared/componentPackageMeta'
import type { ComponentAuthoringPorts } from './commitComponentPackageAuthoring'
import { materializeCompositionFragment } from './compositionFragments/compositionFragmentPackage'
import { appendOwnedLayer, offsetDefaultSlideInsertion, slideSceneContext } from '../../core/tools/slideInsertion'
import { appendWorldLayer, defaultWorldOrigin, requireWorldScope } from '../../core/tools/spatialInsertion'
import { allocateCourseLayerOrder, sortScopedLayerList } from '../../core/tools/layerOrder'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'

export interface ComponentInsertionTarget {
  readonly projectId: string
  readonly revision: number
  readonly generation: number
  readonly locationId: string
  readonly stateId: string | null
  readonly scope: string
}

export function captureComponentInsertionTarget(ports: ComponentAuthoringPorts): ComponentInsertionTarget | null {
  const state = ports.read()
  const document = state.document
  const token = state.authoringSession?.token
  if (!document || !token) return null
  const slide = ports.readSlideSession?.()
  return Object.freeze({
    projectId: document.id, revision: document.revision, generation: token.generation,
    locationId: token.locationId, stateId: state.interactionStateId,
    scope: ports.readSpatialSession()?.scope ?? ports.readFlowSession()?.selection.authoringScope ?? slide?.scope ?? state.editingScope,
  })
}

/** Prepare using the existing insertion commands; commit package bytes + all instances once. */
export function insertComponentPackagesAtTarget(
  ports: ComponentAuthoringPorts,
  target: ComponentInsertionTarget,
  packages: readonly ComponentPackageData[],
): { ok: boolean; reason?: string; layerItemIds?: string[] } {
  const current = captureComponentInsertionTarget(ports)
  if (!current || JSON.stringify(current) !== JSON.stringify(target)) {
    return { ok: false, reason: '添加期间工程、页面或编辑范围已改变，请在当前画布重新添加。' }
  }
  if (!packages.length) return { ok: false, reason: '未选择组件。' }
  const state = ports.read()
  try {
    const planned = planComponentPackageInsertion({ document: state.document!, componentPackages: state.componentPackages, assetFiles: state.sidecar?.files,
      spatial: ports.readSpatialSession(), flow: ports.readFlowSession(), slide: ports.readSlideSession?.() ?? null, target, packages })
    if (!ports.persistTransaction(planned.step, `已添加 ${planned.layerItemIds.length} 个组件到当前画布`)) throw new Error('当前没有可用的作者会话。')
    return { ok: true, layerItemIds: planned.layerItemIds }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '组件添加失败。' }
  }
}

/** Shared private plan for UI imports and the versioned tool Facade. */
export function planComponentPackageInsertion(input: {
  document: NonNullable<ReturnType<ComponentAuthoringPorts['read']>['document']>
  componentPackages: ReturnType<ComponentAuthoringPorts['read']>['componentPackages']
  assetFiles?: Readonly<Record<string, Uint8Array>>
  spatial: ReturnType<ComponentAuthoringPorts['readSpatialSession']>
  flow: ReturnType<ComponentAuthoringPorts['readFlowSession']>
  slide: ReturnType<NonNullable<ComponentAuthoringPorts['readSlideSession']>>
  target: ComponentInsertionTarget
  packages: readonly ComponentPackageData[]
  staticFallbackAssetId?: string
  flowPlacement?: FlowComponentInsertRequest['placement']
}) {
  const { document, target, packages, spatial, flow, slide } = input
  if (!packages.length) throw new Error('未选择组件。')
  if (document.id !== target.projectId || document.revision !== target.revision) throw new Error('组件插入工程或 revision 已改变')
  let nextDocument = structuredClone(document)
  const resources: { packageId: string; after: ComponentPackageData }[] = []
  const assetChanges: { assetId: string; after?: Uint8Array }[] = []
  const stagedAssetFiles = { ...input.assetFiles }
  const stagedPackages = { ...input.componentPackages }
  const ids: string[] = []
    const seen = new Set<string>()
    for (const data of packages) {
      const id = data.manifest.id
      if (seen.has(id)) throw new Error('同一批次不能重复添加同一组件。')
      seen.add(id)
      if (!componentSupportsScope(data.manifest, target.scope === 'global' ? 'global' : 'scene')) {
        throw new Error(`“${data.manifest.name}”不支持当前编辑范围。`)
      }
      const existing = input.componentPackages[id]
      if (existing) {
        if (existing.manifest.version !== data.manifest.version || existing.contentSha256 !== data.contentSha256) {
          throw new Error(`“${data.manifest.name}”与工程内版本不同，请先审阅更新。`)
        }
      } else {
        nextDocument.componentPackages[id] = componentPackageMeta(data)
        resources.push({ packageId: id, after: data })
      }
      stagedPackages[id] = data
    }
    for (const data of packages) {
      if (data.manifest.content?.kind === 'composition') {
        const planned = materializeCompositionFragment({ document: nextDocument,
          componentPackages: stagedPackages, assetFiles: stagedAssetFiles, data })
        for (const change of planned.resourceChanges.assetFileChanges ?? []) {
          assetChanges.push(change)
          if (change.after) stagedAssetFiles[change.assetId] = change.after
        }
        for (const change of planned.resourceChanges.componentPackageChanges ?? []) {
          if (change.after) { resources.push({ packageId: change.packageId, after: change.after }); stagedPackages[change.packageId] = change.after }
        }
        const item = planned.item
        if (spatial) {
          requireWorldScope(spatial)
          Object.assign(item.frame, defaultWorldOrigin(spatial, item.frame.width, item.frame.height))
          appendWorldLayer(nextDocument, spatial.selection.surfaceId, item)
        } else if (flow) {
          item.order = allocateCourseLayerOrder(nextDocument, 0)
          if (target.scope === 'global') {
            nextDocument.globalLayerItems.push({ item, plane: 'overlay', visibility: { mode: 'all', locationIds: [] } })
            sortScopedLayerList(nextDocument.globalLayerItems)
          } else {
            const surface = nextDocument.surfaces.find(surface => surface.id === flow.selection.surfaceId)
            if (!surface || surface.type !== 'flow') throw new Error('当前文档已失效。')
            item.paperSpace = 'paper'
            item.frame.x = 24; item.frame.y = 24
            surface.surfaceLayerItems.push({ item, bodyPlane: 'overlay', visibility: { mode: 'all', locationIds: [] }, ...(flow.selection.selectedBlockId
              ? { paragraphAnchor: { blockId: flow.selection.selectedBlockId, offsetY: 24, xRatio: 0 } } : {}) })
            sortScopedLayerList(surface.surfaceLayerItems)
          }
        } else if (slide) {
          const count = slide.scope === 'global' ? nextDocument.globalLayerItems.length : slideSceneContext(nextDocument, slide).scene.layerItems.length
          Object.assign(item.frame, offsetDefaultSlideInsertion(item.frame, count, false))
          appendOwnedLayer(nextDocument, slide, item)
        }
        else throw new Error('当前没有可编辑的画布。')
        ids.push(item.layerItemId)
        continue
      }
      if (spatial) {
        const result = addSpatialWorldComponentLayer({ ...spatial, history: { ...spatial.history, present: nextDocument } }, {
          packageId: data.manifest.id, props: data.manifest.defaultProps,
          staticFallbackAssetId: input.staticFallbackAssetId,
          width: data.manifest.defaultSize.width, height: data.manifest.defaultSize.height,
        })
        if (!result.ok || !result.nextSession) throw new Error(result.reason ?? '组件无法放置在当前画布。')
        nextDocument = structuredClone(result.nextSession.history.present)
        ids.push(...result.nextSession.selection.selectionIds)
      } else if (flow) {
        const result = insertFlowSharedComponent(nextDocument, flow.selection, {
          packageId: data.manifest.id, manifest: data.manifest,
          placement: input.flowPlacement, staticFallbackAssetId: input.staticFallbackAssetId,
        })
        if (!result.ok || !result.nextDocument) throw new Error(result.reason ?? '组件无法放置在当前页面。')
        nextDocument = structuredClone(result.nextDocument)
        ids.push(...(result.createdLayerItemIds ?? result.createdBlockIds ?? []))
      } else if (slide) {
        const result = addSlideComponentLayer({ ...slide, history: { ...slide.history, present: nextDocument } }, {
          packageId: data.manifest.id, manifest: data.manifest,
          staticFallbackAssetId: input.staticFallbackAssetId,
        })
        if (!result.ok || !result.nextSession) throw new Error(result.reason ?? '组件无法放置在当前场景。')
        nextDocument = structuredClone(result.nextSession.history.present)
        ids.push(...result.nextSession.selection.selectionIds)
      } else throw new Error('当前没有可编辑的画布。')
    }
    // The intermediate command results were only plans. They never entered a
    // live history; this entire user operation owns exactly one revision.
    nextDocument.revision = document.revision + 1
    nextDocument.updatedAt = new Date().toISOString()
    nextDocument = courseProjectDocumentSchema.parse(nextDocument)
    const step = createEditorTransactionStep(document, {
      projectId: document.id, baseRevision: document.revision, nextDocument,
      resourceChanges: { componentPackageChanges: resources, ...(assetChanges.length ? { assetFileChanges: assetChanges } : {}) },
    })
    if (!step) throw new Error('组件插入没有产生事务')
    return { step, layerItemIds: ids }
}
