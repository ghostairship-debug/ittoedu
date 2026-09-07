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
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import { componentPackageAddress } from '../tools/componentPackageTool'
import { bytesToBase64 } from '../../export/base64'

export type GenerationReferenceScope = 'selection' | 'page' | 'course'

/** Read-only snapshot: only explicitly selected course content and materials leave the host. */
export function captureGenerationSnapshot(input: {
  expectedResult?: GenerationRequest['expectedResult']
  document: CourseProjectDocument; workspace: WorkspaceIdentityV1; sessionToken: CourseAuthoringSessionToken
  projection: EffectiveLayerProjection; selectedIds: readonly string[]; scope: GenerationReferenceScope
  instruction: string; purpose: GenerationRequest['purpose']; materials?: readonly MaterialRecordV1[]
  confirmedDocuments?: GenerationRequest['confirmedDocuments']; previousResult?: unknown
  catalogPackages?: readonly AvailableComponentCatalogPackage[]
  componentPackages?: Readonly<Record<string, ComponentPackageData>>
}): GenerationRequest {
  const { document, workspace, sessionToken, projection } = input
  if (document.id !== workspace.projectId || sessionToken.revision !== document.revision || projection.revision !== document.revision) throw new Error('工程引用已过期')
  for (const material of input.materials ?? []) if (workspaceIdentityKey(material.workspace) !== workspaceIdentityKey(workspace)) throw new Error('不能引用其他工程的材料')
  const destinations: GenerationRequest['destinations'] = []
  const pages: unknown[] = []
  const referencedPackages = new Set<string>()
  const collectPackages = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if ((record.kind === 'component' || record.type === 'component') && record.component) {
      referencedPackages.add((record.component as { packageId: string }).packageId)
    }
    if (record.type === 'section' && Array.isArray(record.blocks)) record.blocks.forEach(collectPackages)
  }
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
    rows.forEach(row => collectPackages(row.item))
    blocks.forEach(block => collectPackages(block.block))
    for (const block of blocks) destinations.push({ kind: 'update', target: captureFlowEditorAuthoringTarget({ view: flow!, sessionToken: token, target: { kind: 'block', blockId: block.blockId } }) })
    pages.push({ location, surfaceType: view.surfaceType,
      items: rows.map(row => ({ target: row.authoringAddress, item: row.item, selected: location.id === sessionToken.locationId && input.selectedIds.includes(row.id) })),
      blocks: blocks.map(block => ({ target: block.authoringAddress, block: block.block, selected: location.id === sessionToken.locationId && input.selectedIds.includes(block.blockId) })) })
  }
  if (!destinations.length) throw new Error('请选择要引用的对象，或改为引用当前页')
  const componentSources = [...referencedPackages].map(packageId => {
    const data = input.componentPackages?.[packageId], meta = document.componentPackages[packageId]
    if (!data || !meta || data.manifest.version !== meta.version || componentContentSha256(data.files) !== meta.contentSha256) throw new Error(`引用组件 ${packageId} 的完整源码或身份不可用`)
    const target = captureCourseAuthoringTarget({ sessionToken, projectId: document.id, surfaceId: projection.surfaceId,
      stateId: null, owner: 'global', ownerKey: projectEffectiveLayers({ project: document, locationId: sessionToken.locationId, owner: 'global' }).scope.ownerKey,
      itemId: packageId, authoringAddress: componentPackageAddress(document.id, packageId) })
    destinations.push({ kind: 'update', target })
    return { packageId, baseVersion: meta.version, baseContentIdentity: meta.contentSha256, target,
      documentRevision: document.revision, sharedEdit: true,
      files: Object.fromEntries(Object.entries(data.files).map(([path, bytes]) => [path,
        /\.(js|json|css|txt|svg)$/i.test(path) ? { encoding: 'utf8', text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } : bytesToBase64(bytes)])),
      editInstruction: 'Use component.package operation revise with this exact target, baseVersion and baseContentIdentity. Return complete files including unchanged files; keep manifest ID and version at the baseline. The host assigns the new version and updates all instances.' }
  })
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace,
    documentRevision: document.revision, sessionGeneration: sessionToken.generation, purpose: input.purpose,
    expectedResult: input.expectedResult ?? 'candidate',
    instruction: input.instruction, destinations, confirmedDocuments: input.confirmedDocuments,
    allowedCarriers: ['native', 'recipe', 'existing-component', 'generated-component', 'runtime'],
    context: JSON.parse(JSON.stringify({ reference: input.scope, pages, materials: input.materials ?? [],
      tools: describeAuthoringTools(), recipes: RECIPE_CATALOG, dynamicCapabilities: generationDynamicCapabilities(),
      assets: document.assets, componentPackages: document.componentPackages, componentSources,
      componentCatalog: (input.catalogPackages ?? []).filter(entry => entry.sourceTrust !== 'prompt').map(entry => ({ sourceId: entry.sourceId,
        packageId: entry.packageId, version: entry.version, sha256: entry.sha256, name: entry.name, description: entry.description,
        tags: entry.tags, supportedScopes: entry.supportedScopes })),
      previousResult: input.previousResult ?? null })),
  })
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > MAX_GENERATION_PROMPT_BYTES - 16000) throw new Error('引用超过本轮上下文预算，请缩小页面或材料范围')
  return request
}
