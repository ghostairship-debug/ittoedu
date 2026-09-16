import { z } from 'zod'
import { withDefaultComponentController } from '../components/teacherControllerComponent'
import { bytesToBase64 } from '../export/base64'
import { createBlankCourseProject } from '../project/createCourseProject'
import { createBlankFlowCourseProject } from '../project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../project/createSpatialCourseProject'
import { createAuthoringToolFacade } from '../authoring/tools/authoringToolFacade'
import type { AuthoringToolCommitPort } from '../authoring/tools/executeAuthoringTool'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress, type CourseAuthoringOwner, type CourseAuthoringScopeToken } from '../authoring/courseAuthoringScope'
import { projectEffectiveLayers } from './effectiveLayerProjection'
import { resolveComponentEditorProperties } from '../../shared/componentProps'
import { listOwnedLayerItems } from './effectiveLayerCommands'
import { makeFlowBlockAuthoringAddress, carrierForFlowBlock } from './flowDocumentModel'
import type { FlowBlock } from '../../shared/courseProjectTypes'
import { createResourceAwareAuthoringHistory, commitEditorTransactionToAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { applyEditorTransactionStep } from '../authoring/editorTransaction'
import type { HistoryResourceState } from '../store/courseResourceState'
import { readAuthoringToolSelection, type AuthoringToolCreateScopeV1, type AuthoringToolDestinationV1, type AuthoringToolReceiptV1 } from '../../shared/authoringToolContract'
import generatedCapabilities from '../../shared/generated/courseAgentCapabilities.json'
import { queryCourseAgentCapabilities, readCourseAgentCapability, type CourseAgentCapabilityData,
  type CourseAgentCapabilityQuery, type CourseAgentCapabilityCardOptions } from '../../shared/courseAgentCapabilities'

const optionsSchema = z.object({ surfaceType: z.enum(['slide', 'flow', 'spatial-2d']), title: z.string().trim().min(1).max(120) }).strict()
export type CoursewareBuilderV2Options = z.infer<typeof optionsSchema>
const capabilities = generatedCapabilities as CourseAgentCapabilityData
const observeSchema = z.object({ itemIds: z.array(z.string().min(1)).max(100).optional(), includeContent: z.boolean().optional(),
  includeLocations: z.boolean().optional(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict()
export type CoursewareBuilderObservationOptions = z.input<typeof observeSchema>
const receiptQuerySchema = z.object({ after: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(20) }).strict()

export interface CoursewareBuilderV2Owner extends AuthoringToolCommitPort {
  readResources(): HistoryResourceState
  readScope(): CourseAuthoringScopeToken
  readGeneration(): number
  activate(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }): void
  beforeExecute?(): Promise<void>
}

/** Private builder document; every edit uses the same product tool and transaction as the editor. */
export function createCoursewareBuilderV2(raw: CoursewareBuilderV2Options) {
  const options = optionsSchema.parse(raw)
  const bundle = withDefaultComponentController((options.surfaceType === 'slide' ? createBlankCourseProject : options.surfaceType === 'flow' ? createBlankFlowCourseProject : createBlankSpatialCourseProject)({ title: options.title }))
  const project = bundle.project
  let history = createResourceAwareAuthoringHistory(project)
  let resources: HistoryResourceState = { assetFiles: {}, componentPackages: bundle.componentPackages }
  let scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId })
  let generation = 1
  const owner: CoursewareBuilderV2Owner = {
    readDocument: () => history.present,
    readResources: () => resources,
    validateDestination(destination) {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      return target.sessionGeneration === generation && target.locationId === scope.locationId && target.owner === scope.owner && target.stateId === scope.stateId
        ? null : { code: 'session-stale', message: 'Builder 当前 scope 已改变', path: ['destination'] }
    },
    commit(step) {
      const hint = readAuthoringToolSelection(step.selectionHint)
      const nextScope = hint ? courseAuthoringScopeFromLocation({ project: step.nextDocument, locationId: hint.locationId, owner: hint.owner, stateId: hint.stateId }) : scope
      const applied = applyEditorTransactionStep({ document: history.present, resources }, step, 'forward')
      const nextHistory = commitEditorTransactionToAuthoringHistory(history, step)
      if (nextScope.locationId !== scope.locationId || nextScope.owner !== scope.owner || nextScope.stateId !== scope.stateId) generation++
      history = nextHistory
      resources = applied.resources
      scope = nextScope
      return true
    },
    readScope: () => scope,
    readGeneration: () => generation,
    activate(input) {
      const next = courseAuthoringScopeFromLocation({ project: history.present, ...input })
      if (JSON.stringify(next) !== JSON.stringify(scope)) generation++
      scope = next
    },
  }
  return createCoursewareBuilderV2WithOwner(owner)
}

/** Same-window product wrapper: all document, resource, scope and history state belongs to the injected canonical Owner. */
export function createCoursewareBuilderV2WithOwner(owner: CoursewareBuilderV2Owner) {
  let sequence = 0
  const receipts: AuthoringToolReceiptV1[] = []
  const facade = createAuthoringToolFacade(owner)
  const currentWire = () => ({ projectId: owner.readDocument().id, documentRevision: owner.readDocument().revision, revisionPolicy: { kind: 'exact' as const },
    sessionGeneration: owner.readGeneration(), surfaceType: owner.readDocument().surfaces.find(entry => entry.id === owner.readScope().surfaceId)!.type,
    surfaceId: owner.readScope().surfaceId, locationId: owner.readScope().locationId, stateId: owner.readScope().stateId, owner: owner.readScope().owner, ownerKey: owner.readScope().ownerKey })
  const currentTargets = () => {
    const surface = owner.readDocument().surfaces.find(entry => entry.id === owner.readScope().surfaceId)!
    const wire = currentWire()
    const content = listOwnedLayerItems(owner.readDocument(), owner.readScope().owner, { surfaceId: owner.readScope().surfaceId, sceneId: owner.readScope().sceneId }).map(item => ({ ...wire, itemId: item.layerItemId,
      authoringAddress: makeLayerItemAuthoringAddress({ projectId: owner.readDocument().id, owner: owner.readScope().owner, surfaceId: surface.id, sceneId: owner.readScope().sceneId, kind: item.kind, layerItemId: item.layerItemId }) }))
    if (surface.type === 'flow' && owner.readScope().owner === 'surface') {
      const append = (blocks: readonly FlowBlock[]) => { for (const block of blocks) {
        content.push({ ...wire, itemId: block.id, authoringAddress: makeFlowBlockAuthoringAddress({ projectId: owner.readDocument().id, surfaceId: surface.id, blockId: block.id, carrier: carrierForFlowBlock(block) }) })
        if (block.type === 'section') append(block.blocks)
      } }
      append(surface.blocks)
    }
    return content
  }
  const snapshot = () => structuredClone({ project: owner.readDocument(), scope: owner.readScope(), generation: owner.readGeneration(), receipts, targets: { content: currentTargets() } })
  const observe = (input: CoursewareBuilderObservationOptions = {}) => {
    const query = observeSchema.parse(input)
    const all = currentTargets()
    if (query.itemIds?.some(id => !all.some(target => target.itemId === id))) throw new Error('观察目标不属于当前 scope')
    const matches = query.itemIds ? all.filter(target => query.itemIds!.includes(target.itemId)) : all
    const content = matches.slice(query.offset, query.offset + query.limit)
    const surface = owner.readDocument().surfaces.find(entry => entry.id === owner.readScope().surfaceId)!
    const selected = new Set(content.map(target => target.itemId))
    const surfaceGeometry = surface.type === 'slide'
      ? { type: surface.type, canvas: surface.canvas }
      : surface.type === 'flow'
        ? { type: surface.type, layout: surface.layout }
        : { type: surface.type, bounds: surface.world.bounds, camera: surface.camera }
    const effectiveRows = query.includeContent ? projectEffectiveLayers({ project: owner.readDocument(),
      locationId: owner.readScope().locationId, stateId: owner.readScope().stateId, owner: owner.readScope().owner,
    }).unifiedRows : []
    const effectiveLayout = effectiveRows.filter(row => row.ownerKey === owner.readScope().ownerKey && selected.has(row.id)).map(row => ({
      itemId: row.id, frame: row.frame, rotation: row.rotation, opacity: row.item.opacity,
      visible: row.effectiveVisible, stateOverrideApplied: row.stateOverrideApplied,
      stackOrder: row.stackOrder, globalPlane: row.globalPlane, flowBodyPlane: row.flowBodyPlane,
    }))
    const componentDefinitions: unknown[] = []
    const describeComponent = (itemId: string, component: { packageId: string; version: string }, props: Record<string, unknown>) => {
      const manifest = owner.readResources().componentPackages[component.packageId]?.manifest
      if (manifest && manifest.version === component.version) componentDefinitions.push({ itemId, ...component,
        defaultSize: manifest.defaultSize, minSize: manifest.minSize,
        publicProperties: resolveComponentEditorProperties(manifest, props),
      })
    }
    const items: unknown[] = []
    if (query.includeContent) {
      for (const item of listOwnedLayerItems(owner.readDocument(), owner.readScope().owner, { surfaceId: owner.readScope().surfaceId, sceneId: owner.readScope().sceneId })) {
        if (selected.has(item.layerItemId)) {
          if (item.kind === 'runtime') { const { source: _source, ...runtime } = item.runtime; items.push({ ...item, runtime, sourceAvailable: true }) }
          else items.push(item)
          if (item.kind === 'component') {
            const effective = effectiveRows.find(row => row.id === item.layerItemId && row.ownerKey === owner.readScope().ownerKey)?.item
            describeComponent(item.layerItemId, item.component, effective?.kind === 'component' ? effective.props : item.props)
          }
        }
      }
      if (surface.type === 'flow' && owner.readScope().owner === 'surface') {
        const visit = (blocks: readonly FlowBlock[]) => { for (const block of blocks) {
          if (selected.has(block.id)) items.push(block.type === 'section' ? { ...block, blocks: block.blocks.map(child => ({ id: child.id, type: child.type })) } : block)
          if (selected.has(block.id) && block.type === 'component') describeComponent(block.id, block.component, block.props)
          if (block.type === 'section') visit(block.blocks)
        } }
        visit(surface.blocks)
      }
    }
    return structuredClone({ version: 1 as const, projectId: owner.readDocument().id, documentRevision: owner.readDocument().revision, scope: owner.readScope(), generation: owner.readGeneration(),
      targets: { content, total: matches.length, nextOffset: query.offset + content.length < matches.length ? query.offset + content.length : null },
      receiptCount: receipts.length, surfaceGeometry, ...(query.includeContent ? { items, contentMode: 'raw' as const, effectiveLayout, componentDefinitions } : {}),
      ...(query.includeLocations ? { locations: owner.readDocument().locations } : {}) })
  }
  const activate = (input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }) => owner.activate(input)
  return Object.freeze({
    version: 2 as const,
    tools: facade.tools,
    discover: (query: CourseAgentCapabilityQuery = {}) => queryCourseAgentCapabilities(capabilities, query),
    readCapability: (id: string, options: CourseAgentCapabilityCardOptions = {}) => readCourseAgentCapability(capabilities, id, options),
    observe,
    readReceipts(input: z.input<typeof receiptQuerySchema> = {}) {
      const query = receiptQuerySchema.parse(input)
      if (query.after > receipts.length) throw new Error('回执游标不属于当前会话')
      const entries = receipts.slice(query.after, query.after + query.limit)
      return structuredClone({ after: query.after, cursor: query.after + entries.length, total: receipts.length, receipts: entries })
    },
    snapshot,
    activate(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }) {
      activate(input)
      return snapshot()
    },
    activateScope(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }) { activate(input); return observe() },
    createScope(input: Pick<AuthoringToolCreateScopeV1, 'parent' | 'insertion'>): AuthoringToolCreateScopeV1 {
      const surface = owner.readDocument().surfaces.find(entry => entry.id === owner.readScope().surfaceId)!
      return { projectId: owner.readDocument().id, documentRevision: owner.readDocument().revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: owner.readGeneration(),
        surfaceType: surface.type, surfaceId: surface.id, locationId: owner.readScope().locationId, stateId: owner.readScope().stateId, owner: owner.readScope().owner, ownerKey: owner.readScope().ownerKey, ...structuredClone(input) }
    },
    async execute(tool: string, input: unknown, destination: AuthoringToolDestinationV1) {
      await owner.beforeExecute?.()
      const receipt = await facade.execute({ version: 1, requestId: `builder-step-${++sequence}`, tool, input, destination })
      receipts.push(receipt)
      return structuredClone(receipt)
    },
    finish() {
      return structuredClone({ project: owner.readDocument(), assetFiles: owner.readResources().assetFiles,
        componentFiles: Object.fromEntries(Object.entries(owner.readResources().componentPackages).map(([id, data]) => [id, data.files])), receipts })
    },
  })
}
export type CoursewareBuilderV2 = ReturnType<typeof createCoursewareBuilderV2>

/** Binary transport belongs to the product worker, never the external case module. */
export function encodeCoursewareBuilderV2Output(output: ReturnType<CoursewareBuilderV2['finish']>) {
  return { project: output.project, receipts: output.receipts,
    assetFiles: Object.fromEntries(Object.entries(output.assetFiles).map(([id, bytes]) => [id, bytesToBase64(bytes)])),
    componentFiles: Object.fromEntries(Object.entries(output.componentFiles).map(([id, files]) => [id,
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytesToBase64(bytes)]))])) }
}
