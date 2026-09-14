import { generationRequestSchema, MAX_GENERATION_PROMPT_BYTES, type GenerationRequest } from '../../../shared/generationContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../../shared/workspaceIdentity'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import type { AvailableComponentCatalogPackage } from '../../../shared/componentCatalog'
import { captureCourseAuthoringTarget, type CourseAuthoringSessionToken } from '../courseAuthoringSession'
import { projectEffectiveLayers, type EffectiveLayerProjection } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import { generationCapabilityContext } from './generationCapabilities'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { componentContentSha256 } from '../../../shared/componentContentIntegrity'
import { componentPackageAddress } from '../tools/componentPackageTool'
import { bytesToBase64 } from '../../export/base64'
import { generationImageDiagnostics } from './generationImageDiagnostics'
import { captureBackgroundTargets } from '../tools/backgroundTool'
import { captureGenerationSelectionActions } from './selectionActionTargets'

export type GenerationReferenceScope = 'selection' | 'page' | 'course'

/** A reference is presentation focus, never an authorization inferred from selection. */
export function resolveGenerationReferenceScope(input: { instruction: string; scope: GenerationReferenceScope; scopeExplicit?: boolean }): GenerationReferenceScope {
  return input.scope
}

/** Frozen project inventory on disk; the initial prompt keeps only the requested focus. */
export function captureGenerationSnapshot(input: {
  expectedResult?: GenerationRequest['expectedResult']
  intent?: GenerationRequest['intent']
  applyPolicy?: GenerationRequest['applyPolicy']
  observation?: GenerationRequest['observation']
  observationResourceFiles?: GenerationRequest['resourceFiles']
  document: CourseProjectDocument; workspace: WorkspaceIdentityV1; sessionToken: CourseAuthoringSessionToken
  projection: EffectiveLayerProjection; selectedIds: readonly string[]; scope: GenerationReferenceScope
  flowSelection?: FlowEditorSelection
  /** Locations created by this task's actual receipts, in addition to its frozen page scope. */
  additionalLocationIds?: readonly string[]
  /** Feedback may discover a new package dependency without authorizing shared source edits. */
  sharedComponentSourceAddresses?: readonly string[]
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
  const focusedPackages = new Set<string>()
  const collectPackages = (value: unknown, focused = false): void => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if ((record.kind === 'component' || record.type === 'component') && record.component) {
      referencedPackages.add((record.component as { packageId: string }).packageId)
      if (focused) focusedPackages.add((record.component as { packageId: string }).packageId)
    }
    if (record.type === 'section' && Array.isArray(record.blocks)) record.blocks.forEach(block => collectPackages(block, focused))
  }
  const requestedLocations = document.locations
  // A Flow location is a heading anchor inside one document, not a new page.
  // Keep the frozen active anchor and collect each Flow surface once, including
  // when a committed heading introduces another location during feedback.
  const flowLocations = new Map<string, string>()
  for (const location of requestedLocations) {
    if (document.surfaces.find(surface => surface.id === location.surfaceId)?.type !== 'flow') continue
    if (!flowLocations.has(location.surfaceId) || location.id === sessionToken.locationId) flowLocations.set(location.surfaceId, location.id)
  }
  const locations = requestedLocations.filter(location => !flowLocations.has(location.surfaceId) || flowLocations.get(location.surfaceId) === location.id)
  for (const location of locations) {
    const view = location.id === projection.locationId ? projection : projectEffectiveLayers({ project: document, locationId: location.id })
    const token = { ...sessionToken, locationId: location.id, surfaceType: view.surfaceType }
    const scope = { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' as const },
      sessionGeneration: token.generation, surfaceType: view.surfaceType, surfaceId: view.surfaceId,
      locationId: location.id, stateId: view.stateId, owner: view.scope.owner, ownerKey: view.scope.ownerKey }
    {
      destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
      if (view.surfaceType === 'flow') destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'flow-body', parentBlockId: null }, insertion: { kind: 'append' } } })
      if (view.surfaceType === 'slide') destinations.push({ kind: 'create', scope: { ...scope, parent: { kind: 'course-locations' }, insertion: { kind: 'after', siblingId: location.id } } })
      const globalScope = projectEffectiveLayers({ project: document, locationId: location.id, owner: 'global' }).scope
      destinations.push({ kind: 'create', scope: { ...scope, stateId: null, owner: 'global', ownerKey: globalScope.ownerKey, parent: { kind: 'owner' }, insertion: { kind: 'append' } } })
      if (location.id === sessionToken.locationId) destinations.push({ kind: 'create', scope: {
        ...scope, stateId: null, owner: 'global', ownerKey: globalScope.ownerKey, parent: { kind: 'course-locations' }, insertion: { kind: 'append' },
      } })
    }
    const rows = view.unifiedRows
    for (const row of rows) destinations.push({ kind: 'update', target: captureCourseAuthoringTarget({ sessionToken: token,
      projectId: document.id, surfaceId: view.surfaceId, stateId: view.stateId, owner: row.owner, ownerKey: row.ownerKey,
      itemId: row.id, authoringAddress: row.authoringAddress }) })
    const flow = view.surfaceType === 'flow' ? buildFlowEditorView({ project: document, locationId: location.id }) : null
    const blocks = flow?.blocks ?? []
    const focused = (id: string) => input.scope === 'course' || location.id === sessionToken.locationId && (input.scope === 'page' || input.selectedIds.includes(id))
    rows.forEach(row => collectPackages(row.item, focused(row.id)))
    blocks.forEach(block => collectPackages(block.block, focused(block.blockId)))
    for (const block of blocks) destinations.push({ kind: 'update', target: captureFlowEditorAuthoringTarget({ view: flow!, sessionToken: token, target: { kind: 'block', blockId: block.blockId } }) })
    const surface = document.surfaces.find(value => value.id === location.surfaceId)
    const pageOwner = view.surfaceType === 'slide' ? 'scene' : 'surface'
    const backgrounds = captureBackgroundTargets({ document, sessionToken: token, stateId: view.stateId, reference: 'course' })
      .sort((a, b) => Number(b.target.owner === pageOwner) - Number(a.target.owner === pageOwner))
    for (const background of backgrounds) destinations.push({ kind: 'update', target: background.target })
    pages.push({ location, surfaceType: view.surfaceType,
      ...(surface?.type === 'slide' ? { canvas: { ...surface.canvas } } : {}),
      ...(surface?.type === 'flow' ? { layout: { ...surface.layout, widthMode: surface.layout.widthMode ?? 'reading' },
        coordinates: { unit: 'CSS px', body: 'flow.content blocks reserve document space and reflow',
          paper: 'native.content template/properties.paperSpace=paper; origin is paper border box; follows document scroll; does not reserve space',
          viewport: 'native.content template/properties.paperSpace=viewport; fixed to viewport; does not reserve space',
          controller: 'independent viewport overlay: legacy Native uses bottom-center layout; component role preserves authored frame with viewport clamping; neither follows course zoom/pan or paper scroll',
          measuredGeometry: 'observation/current-structure.json flowView when this surface is mounted' } } : {}),
      ...(backgrounds.length ? { backgrounds } : {}),
      items: rows.map(row => ({ target: row.authoringAddress, item: row.item, selected: location.id === sessionToken.locationId && input.selectedIds.includes(row.id) })),
      blocks: blocks.map(block => ({ target: block.authoringAddress, block: block.block, selected: location.id === sessionToken.locationId && input.selectedIds.includes(block.blockId) })) })
  }
  if (!destinations.length) throw new Error('请选择要引用的对象，或改为引用当前页')
  const selectedTargets = destinations.flatMap(destination => destination.kind === 'update' && destination.target.locationId === sessionToken.locationId && input.selectedIds.includes(destination.target.itemId) ? [destination.target] : [])
  const selectionActions = input.scope === 'selection' ? captureGenerationSelectionActions(document, selectedTargets, input.instruction) : []
  for (const action of selectionActions) if (action.operation === 'insert-image-after') destinations.push(action.destination)
  const resourceFiles: NonNullable<GenerationRequest['resourceFiles']> = []
  resourceFiles.push({ path: 'project/document.json', encoding: 'utf8', role: 'source', mediaType: 'application/json', content: JSON.stringify(document) })
  const materialReferences = (input.materials ?? []).map(material => {
    const { text, ...metadata } = material
    const resourcePath = `materials/${encodeURIComponent(material.id)}.txt`
    resourceFiles.push({ path: resourcePath, encoding: 'utf8', content: text, mediaType: 'text/plain', role: 'material' })
    return { ...metadata, textFile: `resources/${resourcePath}`, textByteLength: new TextEncoder().encode(text).byteLength }
  })
  const runtimeSources: { path: string; runtimeApiVersion: number; target: unknown }[] = []
  const detachRuntimeSources = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(detachRuntimeSources)
    if (!value || typeof value !== 'object') return value
    const node = value as Record<string, any>
    const copy = Object.fromEntries(Object.entries(node).map(([key, nested]) => [key, detachRuntimeSources(nested)]))
    if (node.kind === 'runtime' && typeof node.runtime?.source === 'string') {
      const resourcePath = `runtimes/${encodeURIComponent(node.layerItemId)}.js`
      if (!resourceFiles.some(file => file.path === resourcePath)) {
        resourceFiles.push({ path: resourcePath, encoding: 'utf8', content: node.runtime.source, role: 'source' })
        runtimeSources.push({ path: `resources/${resourcePath}`, runtimeApiVersion: node.runtime.runtimeApiVersion,
          target: destinations.find(destination => destination.kind === 'update' && destination.target.itemId === node.layerItemId) })
      }
      const { source: _source, ...runtime } = node.runtime
      copy.runtime = { ...runtime, sourceFile: `resources/${resourcePath}` }
    }
    return copy
  }
  const promptPages = pages.map(detachRuntimeSources)
  const focusPages = input.scope === 'course' ? promptPages : promptPages.filter(page => (page as any).location.id === sessionToken.locationId || input.additionalLocationIds?.includes((page as any).location.id))
  const capabilityPages = input.scope === 'selection' ? focusPages.map((page: any) => ({ ...page, backgrounds: undefined,
    items: page.items.filter((row: any) => row.selected), blocks: page.blocks.filter((row: any) => row.selected) })) : focusPages
  const componentSources = [...referencedPackages].map(packageId => {
    const data = input.componentPackages?.[packageId], meta = document.componentPackages[packageId]
    if (!data || !meta || data.manifest.version !== meta.version || componentContentSha256(data.files) !== meta.contentSha256) {
      if (focusedPackages.has(packageId)) throw new Error(`引用组件 ${packageId} 的完整源码或身份不可用`)
      return { packageId, sourceUnavailable: '此非焦点组件未附加有效源码；保留既有资源引用或读取工程包，不要猜造源码' }
    }
    const target = captureCourseAuthoringTarget({ sessionToken, projectId: document.id, surfaceId: projection.surfaceId,
      stateId: null, owner: 'global', ownerKey: projectEffectiveLayers({ project: document, locationId: sessionToken.locationId, owner: 'global' }).scope.ownerKey,
      itemId: packageId, authoringAddress: componentPackageAddress(document.id, packageId) })
    const sharedAllowed = input.sharedComponentSourceAddresses === undefined || input.sharedComponentSourceAddresses.includes(target.authoringAddress)
    if (sharedAllowed) destinations.push({ kind: 'update', target })
    const instanceTargets = new Set<string>()
    const instances = pages.flatMap(page => {
      const { items, blocks } = page as { items: { target: string; item: any; selected: boolean }[]; blocks: { target: string; block: any; selected: boolean }[] }
      return [...items.map(row => ({ ...row, node: row.item })), ...blocks.map(row => ({ ...row, node: row.block }))]
        .filter(row => (row.node.kind === 'component' || row.node.type === 'component') && row.node.component.packageId === packageId)
        .flatMap(row => {
          const destination = destinations.find(value => value.kind === 'update' && value.target.authoringAddress === row.target)
          if (!destination || destination.kind !== 'update') return []
          const identity = JSON.stringify(destination.target)
          if (instanceTargets.has(identity)) return []
          instanceTargets.add(identity)
          const reason = destination.target.stateId !== null ? 'named-state-package-rebind-unsupported'
            : row.node.locked ? 'instance-locked' : undefined
          return [{ target: destination.target, selected: row.selected,
            sourcePatch: reason ? { status: 'unavailable', reason } : { status: 'available' } }]
        })
    })
    return { packageId, baseVersion: meta.version, baseContentIdentity: meta.contentSha256, ...(sharedAllowed ? { target } : {}),
      documentRevision: document.revision,
      editTargets: { instance: instances, shared: sharedAllowed
        ? { target, affects: 'all-package-instances', requiresExplicitSharedScope: true }
        : { status: 'unavailable', reason: 'outside-original-task-scope' } },
      files: Object.fromEntries(Object.entries(data.files).map(([path, bytes]) => {
        const resourcePath = `components/${encodeURIComponent(packageId)}/${path}`
        const isText = /\.(js|json|css|txt|svg)$/i.test(path)
        resourceFiles.push({ path: resourcePath, encoding: isText ? 'utf8' : 'base64', role: 'source',
          content: isText ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytesToBase64(bytes) })
        return [path, { path: `resources/${resourcePath}`, bytes: bytes.byteLength, encoding: isText ? 'utf8' : 'base64' }]
      })),
      editInstruction: 'Public parameter edits use component.configure. Source edits prefer component.package operation patch with basePackageId equal to packageId, exact baseVersion and baseContentIdentity; send only changedFiles and explicit deleteFiles. For one instance use mode:instance and its available editTargets.instance target; an exclusive editable copy retains its package ID, otherwise the host forks and rebinds only that instance. Use mode:shared and editTargets.shared.target only when the user explicitly requests all package instances. Read baseline files as needed and keep manifest ID/version unchanged; the host fills unchanged files and assigns identity/version. Full files operation revise remains available for an explicitly shared full-package revision.' }
  })
  const componentCatalog = (input.catalogPackages ?? []).filter(entry => entry.sourceTrust !== 'prompt').map(entry => ({ sourceId: entry.sourceId,
    packageId: entry.packageId, version: entry.version, sha256: entry.sha256, name: entry.name, description: entry.description,
    tags: entry.tags, supportedScopes: entry.supportedScopes }))
  resourceFiles.push({ path: 'component-catalog.json', encoding: 'utf8', role: 'capability', content: JSON.stringify(componentCatalog) })
  // Keep selected aliases first while retaining every discoverable destination.
  const priority = (destination: GenerationRequest['destinations'][number]) => {
    const target = destination.kind === 'update' ? destination.target : destination.scope
    return target.locationId !== sessionToken.locationId ? 2 : destination.kind === 'update' && input.selectedIds.includes(destination.target.itemId) ? 0 : 1
  }
  destinations.sort((a, b) => priority(a) - priority(b))
  resourceFiles.push({ path: 'project/targets.json', encoding: 'utf8', role: 'source', mediaType: 'application/json', content: JSON.stringify({ pages: promptPages }) })
  const request = generationRequestSchema.parse({ version: 1, requestId: crypto.randomUUID(), workspace,
    documentRevision: document.revision, sessionGeneration: sessionToken.generation, purpose: input.purpose,
    expectedResult: input.expectedResult ?? 'candidate', intent: input.intent, applyPolicy: input.applyPolicy, observation: input.observation,
    instruction: input.instruction, destinations, confirmedDocuments: input.confirmedDocuments,
    ...(selectionActions.length ? { selectionActions } : {}),
    allowedCarriers: ['native', 'recipe', 'existing-component', 'generated-component', 'runtime'],
    resourceFiles,
    context: JSON.parse(JSON.stringify({ reference: input.scope, focusLocationId: sessionToken.locationId, modificationScope: 'project',
      projectDocument: 'resources/project/document.json', projectTargets: 'resources/project/targets.json', pages: focusPages, materials: materialReferences,
      ...(input.scope === 'selection' && projection.surfaceType === 'flow' && input.flowSelection
        ? { flowSelection: input.flowSelection } : {}),
      capabilities: generationCapabilityContext(capabilityPages, input.purpose, undefined, input.instruction),
      imageDiagnostics: generationImageDiagnostics({ pages: focusPages, assets: document.assets,
        observation: input.observation, resourceFiles: input.observationResourceFiles }),
      assets: document.assets, componentPackages: document.componentPackages, componentSources, runtimeSources,
      componentCatalog: componentCatalog.filter(entry => referencedPackages.has(entry.packageId)),
      componentCatalogFile: { path: 'resources/component-catalog.json', count: componentCatalog.length },
      previousResult: input.previousResult ?? null })),
  })
  const { resourceFiles: _resources, ...prompt } = request
  if (new TextEncoder().encode(JSON.stringify(prompt)).byteLength > MAX_GENERATION_PROMPT_BYTES - 16000) throw new Error('引用超过本轮上下文预算，请缩小页面或材料范围')
  return request
}
