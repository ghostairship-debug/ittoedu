import { generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../../shared/generationContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../../shared/workspaceIdentity'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import type { AvailableComponentCatalogPackage } from '../../../shared/componentCatalog'
import { captureCourseAuthoringTarget, type CourseAuthoringSessionToken } from '../courseAuthoringSession'
import { projectEffectiveLayers, type EffectiveLayerProjection } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '../../course/flowEditorView'
import { describeAuthoringTools } from '../tools/authoringToolFacade'
import { generationDynamicCapabilities } from './generationCapabilities'
import { RECIPE_CATALOG } from '../../recipes/recipeCatalog'

export type GenerationReferenceScope = 'selection' | 'page' | 'course'

/** Read-only snapshot: only explicitly selected course content and materials leave the host. */
export function captureGenerationSnapshot(input: {
  document: CourseProjectDocument; workspace: WorkspaceIdentityV1; sessionToken: CourseAuthoringSessionToken
  projection: EffectiveLayerProjection; selectedIds: readonly string[]; scope: GenerationReferenceScope
  instruction: string; purpose: GenerationRequest['purpose']; materials?: readonly MaterialRecordV1[]
  confirmedDocuments?: GenerationRequest['confirmedDocuments']; previousResult?: unknown
  catalogPackages?: readonly AvailableComponentCatalogPackage[]
}): GenerationRequest {
  const { document, workspace, sessionToken, projection } = input
  if (document.id !== workspace.projectId || sessionToken.revision !== document.revision || projection.revision !== document.revision) throw new Error('工程引用已过期')
  for (const material of input.materials ?? []) if (workspaceIdentityKey(material.workspace) !== workspaceIdentityKey(workspace)) throw new Error('不能引用其他工程的材料')
  const destinations: GenerationRequest['destinations'] = []
  const pages: unknown[] = []
  const locations = input.scope === 'course' ? document.locations : document.locations.filter(location => location.id === sessionToken.locationId)
  for (const location of locations) {
    const view = location.id === projection.locationId ? projection : projectEffectiveLayers({ project: document, locationId: location.id })
    const token = { ...sessionToken, locationId: location.id, surfaceType: view.surfaceType }
    const scope = { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' as const },
      sessionGeneration: token.generation, surfaceType: view.surfaceType, surfaceId: view.surfaceId,
      locationId: location.id, stateId: view.stateId, owner: view.scope.owner, ownerKey: view.scope.ownerKey }
    if (input.scope !== 'selection') {
      destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
      if (view.surfaceType === 'flow') destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'flow-body', parentBlockId: null }, insertion: { kind: 'append' } } })
      if (view.surfaceType === 'slide') destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'course-locations' }, insertion: { kind: 'after', siblingId: location.id } } })
      const globalScope = projectEffectiveLayers({ project: document, locationId: location.id, owner: 'global' }).scope
      destinations.push({ kind: 'create', scope: { ...scope, owner: 'global', ownerKey: globalScope.ownerKey, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
      if (input.purpose === 'whole-course' || input.scope === 'course') destinations.push({ kind: 'create', scope: {
        ...scope, owner: 'global', ownerKey: globalScope.ownerKey, parent: { kind: 'course-locations' }, insertion: { kind: 'append' },
      } })
    }
    const rows = view.unifiedRows.filter(row => input.scope !== 'selection' || input.selectedIds.includes(row.id))
    for (const row of rows) destinations.push({ kind: 'update', target: captureCourseAuthoringTarget({ sessionToken: token,
      projectId: document.id, surfaceId: view.surfaceId, stateId: view.stateId, owner: row.owner, ownerKey: row.ownerKey,
      itemId: row.id, authoringAddress: row.authoringAddress }) })
    const flow = view.surfaceType === 'flow' ? buildFlowEditorView({ project: document, locationId: location.id }) : null
    const blocks = flow?.blocks.filter(block => input.scope !== 'selection' || input.selectedIds.includes(block.blockId)) ?? []
    for (const block of blocks) destinations.push({ kind: 'update', target: captureFlowEditorAuthoringTarget({ view: flow!, sessionToken: token, target: { kind: 'block', blockId: block.blockId } }) })
    pages.push({ location, surfaceType: view.surfaceType, items: rows.map(row => ({ target: row.authoringAddress, item: row.item })), blocks: blocks.map(block => ({ target: block.authoringAddress, block: block.block })) })
  }
  if (!destinations.length) throw new Error('请选择要引用的对象，或改为引用当前页')
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace,
    documentRevision: document.revision, sessionGeneration: sessionToken.generation, purpose: input.purpose,
    instruction: input.instruction, destinations, confirmedDocuments: input.confirmedDocuments,
    allowedCarriers: ['native', 'recipe', 'existing-component', 'generated-component', 'runtime'],
    context: JSON.parse(JSON.stringify({ reference: input.scope, pages, materials: input.materials ?? [],
      tools: describeAuthoringTools(), recipes: RECIPE_CATALOG, dynamicCapabilities: generationDynamicCapabilities(),
      assets: document.assets, componentPackages: document.componentPackages,
      componentCatalog: (input.catalogPackages ?? []).filter(entry => entry.sourceTrust !== 'prompt').map(entry => ({ sourceId: entry.sourceId,
        packageId: entry.packageId, version: entry.version, sha256: entry.sha256, name: entry.name, description: entry.description,
        tags: entry.tags, supportedScopes: entry.supportedScopes })),
      previousResult: input.previousResult ?? null })),
  })
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_GENERATION_PROMPT_BYTES - 16000) throw new Error('引用超过本轮上下文预算，请缩小页面或材料范围')
  return request
}
