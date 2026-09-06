import { z } from 'zod'
import { bytesToBase64 } from '../export/base64'
import { createBlankCourseProject } from '../project/createCourseProject'
import { createBlankFlowCourseProject } from '../project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../project/createSpatialCourseProject'
import { createAuthoringToolFacade } from '../authoring/tools/authoringToolFacade'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress, type CourseAuthoringOwner } from '../authoring/courseAuthoringScope'
import { listOwnedLayerItems } from './effectiveLayerCommands'
import { makeFlowBlockAuthoringAddress, carrierForFlowBlock } from './flowDocumentModel'
import type { FlowBlock } from '../../shared/courseProjectTypes'
import { createResourceAwareAuthoringHistory, commitEditorTransactionToAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { applyEditorTransactionStep } from '../authoring/editorTransaction'
import type { HistoryResourceState } from '../store/courseResourceState'
import { readAuthoringToolSelection, type AuthoringToolCreateScopeV1, type AuthoringToolDestinationV1, type AuthoringToolReceiptV1 } from '../../shared/authoringToolContract'

const optionsSchema = z.object({ surfaceType: z.enum(['slide', 'flow', 'spatial-2d']), title: z.string().trim().min(1).max(120) }).strict()
export type CoursewareBuilderV2Options = z.infer<typeof optionsSchema>

/** Private builder document; every edit uses the same product tool and transaction as the editor. */
export function createCoursewareBuilderV2(raw: CoursewareBuilderV2Options) {
  const options = optionsSchema.parse(raw)
  const project = (options.surfaceType === 'slide' ? createBlankCourseProject : options.surfaceType === 'flow' ? createBlankFlowCourseProject : createBlankSpatialCourseProject)({ title: options.title })
  let history = createResourceAwareAuthoringHistory(project)
  let resources: HistoryResourceState = { assetFiles: {}, componentPackages: {} }
  let scope = courseAuthoringScopeFromLocation({ project, locationId: project.startLocationId })
  let generation = 1
  let sequence = 0
  const receipts: AuthoringToolReceiptV1[] = []
  const facade = createAuthoringToolFacade({
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
  })
  const currentWire = () => ({ projectId: history.present.id, documentRevision: history.present.revision, revisionPolicy: { kind: 'exact' as const },
    sessionGeneration: generation, surfaceType: history.present.surfaces.find(entry => entry.id === scope.surfaceId)!.type,
    surfaceId: scope.surfaceId, locationId: scope.locationId, stateId: scope.stateId, owner: scope.owner, ownerKey: scope.ownerKey })
  const snapshot = () => {
    const surface = history.present.surfaces.find(entry => entry.id === scope.surfaceId)!
    const wire = currentWire()
    const content = listOwnedLayerItems(history.present, scope.owner, { surfaceId: scope.surfaceId, sceneId: scope.sceneId }).map(item => ({ ...wire, itemId: item.layerItemId,
      authoringAddress: makeLayerItemAuthoringAddress({ projectId: history.present.id, owner: scope.owner, surfaceId: surface.id, sceneId: scope.sceneId, kind: item.kind, layerItemId: item.layerItemId }) }))
    if (surface.type === 'flow' && scope.owner === 'surface') {
      const append = (blocks: readonly FlowBlock[]) => { for (const block of blocks) {
        content.push({ ...wire, itemId: block.id, authoringAddress: makeFlowBlockAuthoringAddress({ projectId: history.present.id, surfaceId: surface.id, blockId: block.id, carrier: carrierForFlowBlock(block) }) })
        if (block.type === 'section') append(block.blocks)
      } }
      append(surface.blocks)
    }
    return structuredClone({ project: history.present, scope, generation, receipts, targets: { content } })
  }
  return Object.freeze({
    version: 2 as const,
    tools: facade.tools,
    snapshot,
    activate(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }) {
      const next = courseAuthoringScopeFromLocation({ project: history.present, ...input })
      if (JSON.stringify(next) !== JSON.stringify(scope)) generation++
      scope = next
      return snapshot()
    },
    createScope(input: Pick<AuthoringToolCreateScopeV1, 'parent' | 'insertion'>): AuthoringToolCreateScopeV1 {
      const surface = history.present.surfaces.find(entry => entry.id === scope.surfaceId)!
      return { projectId: history.present.id, documentRevision: history.present.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: generation,
        surfaceType: surface.type, surfaceId: surface.id, locationId: scope.locationId, stateId: scope.stateId, owner: scope.owner, ownerKey: scope.ownerKey, ...structuredClone(input) }
    },
    async execute(tool: string, input: unknown, destination: AuthoringToolDestinationV1) {
      const receipt = await facade.execute({ version: 1, requestId: `builder-step-${++sequence}`, tool, input, destination })
      receipts.push(receipt)
      return structuredClone(receipt)
    },
    finish() {
      return structuredClone({ project: history.present, assetFiles: resources.assetFiles,
        componentFiles: Object.fromEntries(Object.entries(resources.componentPackages).map(([id, data]) => [id, data.files])), receipts })
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
