import type { FlowTextContent } from '../../document/content'
import type { ComponentFrame } from './frame'
import type { CourseStateDeclaration, CourseStateCondition } from '../course-state/types'
import type { ProjectDesignTokens, CourseTheme } from '../design-v1/types'
import type { ProjectPlaybackSettings } from '../playback-v1/types'
import type { AssetSource, ProjectMediaSettings } from '../media-v1/types'
import type { ComponentAuthorRecord } from './runtime'

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type ComponentRole = 'content' | 'behavior' | 'mixed'

export type ComponentImplementation =
  | { kind: 'builtin'; key: string }
  | ({ kind: 'source'; language: 'javascript' | 'typescript'; dependencies?: string[];
      /** Original module specifiers map to definitions within this source owner. */
      moduleBindings?: Record<string, string>;
      /** Software-owned resource names preserve source lookups when library assets receive new identities. */
      resourceBindings?: Record<string, string> } & (
      | { source: string; workspace?: never }
      /** Files, including the entry, live only in DocumentResources.components[ownerId]. */
      | { workspace: { ownerId: string; entry: string }; source?: never }
    ))

export interface ComponentDefinition {
  readonly id: string
  role: ComponentRole
  implementation: ComponentImplementation
  /** Professional schemas belong to the definition, never to an editor carrier. */
  dataSchema?: JsonObject
  /** Retains professional authoring when the definition uses custom source. */
  professionalBuiltinKey?: string
  version?: string
  title?: string
  library?: { packageId: string; version?: string; baseline?: {
    implementation: ComponentImplementation
    dataSchema?: JsonObject
    /** UTF-8 origin material for source differences, never a runtime source owner. */
    sourceFiles?: Record<string, string>
  } }
}

/** Authoring identity only. Runtime always resolves the effective implementation. */
export function componentDefinitionBuiltinKey(definition: ComponentDefinition | undefined): string | undefined {
  return definition?.implementation.kind === 'builtin' ? definition.implementation.key : definition?.professionalBuiltinKey
}

export type ComponentTarget =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'text-range'; instanceId: string; dataPath: string[]; rangeId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'project' }

export interface BehaviorAttachment {
  instanceId: string
  target: ComponentTarget
}

/** Persistent author changes belong to the instance, independently of its business data or renderer. */
export interface ComponentAuthoring {
  records?: Record<string, ComponentAuthorRecord>
  resourceBindings?: Record<string, string>
}

export interface ComponentInstance<Data = JsonValue> {
  readonly id: string
  definitionId: string
  name?: string
  visible?: boolean
  visibility?: { mode: 'all' | 'include' | 'exclude'; surfaceIds: string[] }
  locked?: boolean
  /** Explicit viewport projection for global controls, independent of navigation privileges. */
  viewportPinned?: boolean
  playbackInitialVisibility?: 'inherit' | 'hidden'
  flowPlacement?: ComponentFlowPlacement
  flowLayout?: ComponentFlowBodyLayout
  /** Explicit Source aliases for declared scalar course state; identities follow canonical rename/copy. */
  stateBindings?: Record<string, string>
  data: Data
  authoring?: ComponentAuthoring
  style?: JsonObject
  frame?: ComponentFrame
  /** The sole ownership and ordering relation; parent indexes are derived. */
  childIds?: string[]
  /** Container authoring belongs to this same instance; surfaces are derived views. */
  container?: ComponentContainerAuthoring
  attachments?: BehaviorAttachment[]
  implementationOverride?: ComponentImplementation
}

export interface ComponentBackground {
  mode?: 'inherit' | 'own'
  color?: string
  assetId?: string | null
  fit?: 'cover' | 'contain' | 'fill'
  /** Background-only paint, back to front. It owns no author instances or layout. */
  paint?: ComponentBackgroundPaint | null
}
export type ComponentBackgroundProperty = 'background-color' | 'background-image' | 'background-size'
  | 'background-position' | 'background-repeat' | 'background-origin' | 'background-clip'
  | 'background-attachment' | 'background-blend-mode'
export interface ComponentBackgroundPaint {
  layers: { style: Partial<Record<ComponentBackgroundProperty, string>>; resourceBindings: Record<string, string> }[]
}
export interface ResolvedComponentBackground {
  color: string
  assetId: string | null
  fit: 'cover' | 'contain' | 'fill'
  paint?: ComponentBackgroundPaint
}
export interface ComponentFlowBodyLayout {
  width: 'content-width' | 'wide' | 'full-width'
  wrap?: 'none' | 'left' | 'right'
  caption?: FlowTextContent
}
export interface ComponentFlowPlacement {
  space: 'paper' | 'viewport'
  plane: 'overlay' | 'underlay'
  paragraphAnchor?: { blockId: string; offsetY: number; xRatio: number }
}
export interface ComponentFlowAuthoring {
  layout: { toc?: 'auto' | 'hidden'; widthMode?: 'fluid' | 'reading'; edgeToEdge?: boolean; readingWidth: number; wideContentWidth: number }
}
export interface ComponentPresentationState {
  id: string
  title: string
  overrides: Record<string, { data?: JsonValue; authoring?: ComponentAuthoring; style?: JsonObject; frame?: ComponentFrame | null; visible?: boolean; playbackInitialVisibility?: 'inherit' | 'hidden' }>
  /** Display order only; the surface childIds remains the ownership relation. */
  order?: string[]
  background?: ComponentBackground
}
export interface ComponentPresentation {
  states: ComponentPresentationState[]
  initialStateId?: string | null
  thumbnailStateId?: string | null
}
export interface CourseProjectLogic {
  courseState: CourseStateDeclaration[]
  navigationGuards: { id: string; effect: 'block'; fromSurfaceIds?: string[]; toSurfaceIds: string[];
    match: 'all' | 'any'; conditions: CourseStateCondition[]; message: string }[]
  network?: { connectOrigins?: string[] }
}

export interface ComponentSurface {
  id: string
  kind: 'slide' | 'flow' | 'spatial'
  title: string
  childIds: string[]
  designSize?: { width: number; height: number }
  spatial?: ComponentSpatialAuthoring
  background?: ComponentBackground
  flow?: ComponentFlowAuthoring
  presentation?: ComponentPresentation
}

export interface ComponentContainerAuthoring {
  kind: ComponentSurface['kind']
  designSize?: ComponentSurface['designSize']
  spatial?: ComponentSpatialAuthoring
  background?: ComponentBackground
  flow?: ComponentFlowAuthoring
  /** Slide scene states; Flow navigates headings and Spatial navigates camera stops. */
  presentation?: ComponentPresentation
}

export interface WorkEntry { rootInstanceId: string }
export type ComponentContainerPatch = { kind?: ComponentContainerAuthoring['kind'] } & {
  [K in Exclude<keyof ComponentContainerAuthoring, 'kind'>]?: ComponentContainerAuthoring[K] | null
}

/** Pose x/y are the viewport center in world coordinates; rotation is degrees. */
export interface ComponentSpatialPose { x: number; y: number; zoom: number; rotation?: number }
export interface ComponentSpatialAuthoring {
  /** Missing/null means authored frames order; reads never materialize a default. */
  defaultPathId?: string | null
  home: ComponentSpatialPose
  frames: { id: string; title?: string; pose: ComponentSpatialPose; targetInstanceId?: string }[]
  paths?: { id: string; title?: string; frameIds: string[]; instanceIds?: string[];
    style?: { color?: string; width?: number; dash?: 'solid' | 'dashed' | 'dotted' } }[]
  relations?: { id: string; sourceInstanceId: string; targetInstanceId: string; label?: string; kind: 'line' | 'arrow' | 'bidirectional' }[]
  semanticZoom?: { id: string; instanceIds: string[]; minZoom: number; maxZoom: number; visible: boolean }[]
}

export interface ComponentAsset {
  id: string
  path: string
  mimeType?: string
  filename?: string
  kind?: 'image' | 'audio' | 'video' | 'font'
  byteLength?: number
  width?: number
  height?: number
  duration?: number
  /** HTTPS delivery of the same embedded bytes; provenance remains in source. */
  remote?: { url: string }
  source?: AssetSource
}

export interface CourseProjectV11 {
  schemaVersion: 11
  id: string
  revision: number
  title: string
  background?: ComponentBackground
  designTokens?: ProjectDesignTokens
  theme?: CourseTheme
  playback?: ProjectPlaybackSettings
  media?: ProjectMediaSettings
  logic?: CourseProjectLogic
  definitions: Record<string, ComponentDefinition>
  instances: Record<string, ComponentInstance>
  rootIds: string[]
  entry?: WorkEntry
  global: { underlay: string[]; overlay: string[] }
  assets: Record<string, ComponentAsset>
}

/** Existing internal module names remain stable while the formal wire format is Project 11. */
export type CourseProjectV10 = CourseProjectV11

/** Accepted only by the one-time V10 read boundary, never a writable Session model. */
export interface LegacyCourseProjectV10 extends Omit<CourseProjectV11, 'schemaVersion' | 'rootIds' | 'entry'> {
  schemaVersion: 10
  surfaces: ComponentSurface[]
}

export function componentContainerBuiltinKey(kind: ComponentContainerAuthoring['kind']): string {
  return `guoling.container.${kind}`
}

export type ComponentContainerReadModel = Pick<CourseProjectV11, 'instances' | 'definitions'>
export type ComponentRootReadModel = ComponentContainerReadModel & Pick<CourseProjectV11, 'rootIds'>

/** A read-only snapshot view. Nested configuration is borrowed, never copied or edited here. */
export function componentSurface(project: ComponentContainerReadModel, instanceId: string): Readonly<ComponentSurface> | undefined {
  const instance = project.instances[instanceId]
  if (!instance?.container) return undefined
  return { ...instance.container, id: instance.id,
    title: instance.name ?? project.definitions[instance.definitionId]?.title ?? instance.id,
    childIds: instance.childIds ?? [] }
}

/** The work-level directory contains root containers only, never nested containers. */
export function componentSurfaces(project: ComponentRootReadModel): readonly Readonly<ComponentSurface>[] {
  return project.rootIds.flatMap(id => { const surface = componentSurface(project, id); return surface ? [surface] : [] })
}

/** Reference/resource/state traversal includes every owned container, including nested ones. */
export function componentContainers(project: ComponentContainerReadModel): readonly Readonly<ComponentSurface>[] {
  return Object.keys(project.instances).flatMap(id => { const surface = componentSurface(project, id); return surface ? [surface] : [] })
}

export function createComponentContainerInstance(surface: ComponentSurface, definitionId: string, instanceId = surface.id): ComponentInstance {
  const { id: _id, title, childIds, ...container } = surface
  return { id: instanceId, definitionId, name: title, data: {}, childIds: [...childIds], container: structuredClone(container) }
}

export type ComponentContainer =
  | { kind: 'project' }
  | { kind: 'instance'; instanceId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'global'; plane: 'underlay' | 'overlay' }

export function containerChildIds(project: CourseProjectV10, container: ComponentContainer): string[] {
  if (container.kind === 'project') return project.rootIds
  if (container.kind === 'global') return project.global[container.plane]
  if (container.kind === 'surface') {
    const instance = project.instances[container.surfaceId]
    if (!instance?.container || !instance.childIds) throw new Error(`容器已不存在：${container.surfaceId}`)
    return instance.childIds
  }
  const instance = project.instances[container.instanceId]
  if (!instance) throw new Error(`容器已不存在：${container.instanceId}`)
  return instance.childIds ?? []
}

export function owningContainer(project: Pick<CourseProjectV11, 'rootIds' | 'global' | 'instances'>, instanceId: string): ComponentContainer | null {
  if (project.rootIds.includes(instanceId)) return { kind: 'project' }
  for (const plane of ['underlay', 'overlay'] as const) if (project.global[plane].includes(instanceId)) return { kind: 'global', plane }
  for (const instance of Object.values(project.instances)) if (instance.childIds?.includes(instanceId)) return { kind: 'instance', instanceId: instance.id }
  return null
}

/** The nearest owning layout/state scope, derived from the one author tree. */
export function componentContainerForInstance(project: ComponentRootReadModel & Pick<CourseProjectV11, 'global'>,
  instanceId: string): Readonly<ComponentSurface> | undefined {
  let owner = owningContainer(project, instanceId)
  while (owner?.kind === 'instance') {
    const container = componentSurface(project, owner.instanceId)
    if (container) return container
    owner = owningContainer(project, owner.instanceId)
  }
  return owner?.kind === 'surface' ? componentSurface(project, owner.surfaceId) : undefined
}

/** An object's editing lock includes its containing groups. */
export function componentIsLocked(project: CourseProjectV10, id: string): boolean {
  if (project.instances[id]?.locked) return true
  const owner = owningContainer(project, id)
  return owner?.kind === 'instance' ? componentIsLocked(project, owner.instanceId) : false
}

export function isComponentVisibleAtSurface(instance: Pick<ComponentInstance, 'visible' | 'visibility'>, surfaceId: string): boolean {
  if (instance.visible === false) return false
  const scope = instance.visibility
  return !scope || scope.mode === 'all' || (scope.mode === 'include' ? scope.surfaceIds.includes(surfaceId) : !scope.surfaceIds.includes(surfaceId))
}

/** Authored background ancestry, back to front. Static media can composite it without inventing author facts. */
export function componentBackgroundChain(project: Pick<CourseProjectV10, 'background'> & Partial<Pick<CourseProjectV10, 'instances'>>,
  surface?: Pick<ComponentSurface, 'background'> & Partial<Pick<ComponentSurface, 'id'>>): ComponentBackground[] {
  const ancestors: ComponentBackground[] = []
  let parentId = surface?.id
  while (parentId && project.instances) {
    const parent = Object.values(project.instances).find(instance => instance.childIds?.includes(parentId!))
    if (!parent) break
    if (parent.container?.background?.mode === 'own') ancestors.unshift(parent.container.background)
    parentId = parent.id
  }
  return [project.background ?? { color: '#ffffff' }, ...ancestors,
    ...(surface?.background?.mode === 'own' ? [surface.background] : [])]
}

/** One effective paint rule for editors, Player and output. */
export function resolveComponentBackground(project: Pick<CourseProjectV10, 'background'> & Partial<Pick<CourseProjectV10, 'instances'>>, surface?: Pick<ComponentSurface, 'background'> & Partial<Pick<ComponentSurface, 'id'>>, state?: Pick<ComponentPresentationState, 'background'>): ResolvedComponentBackground {
  const selected = componentBackgroundChain(project, surface).at(-1)!
  const result: ResolvedComponentBackground = selected?.paint ? { color: 'transparent', assetId: null, fit: 'cover', paint: selected.paint }
    : { color: selected.color ?? 'transparent', assetId: selected?.assetId ?? null, fit: selected?.fit ?? 'cover' as const }
  const override = state?.background
  if (!override || override.mode === 'inherit') return result
  if (override.paint) return { color: 'transparent', assetId: null, fit: 'cover', paint: override.paint }
  const replacesPaint = override.paint === null || ['color', 'assetId', 'fit'].some(key => Reflect.get(override, key) !== undefined)
  if (result.paint && !replacesPaint) return result
  const inherited = result.paint ? { color: 'transparent', assetId: null, fit: 'cover' as const } : result
  return { color: override.color ?? inherited.color, assetId: override.assetId === undefined ? inherited.assetId : override.assetId,
    fit: override.fit ?? inherited.fit }
}

/** The Surface owns only explicit paint. Inheritance is visible through this layer, never repainted. */
export function resolveComponentSurfaceBackground(project: Parameters<typeof resolveComponentBackground>[0],
  surface: ComponentSurface, state?: Pick<ComponentPresentationState, 'background'>): ResolvedComponentBackground | undefined {
  const override = state?.background
  const stateOwnsPaint = override && override.mode !== 'inherit'
    && (override.mode === 'own' || ['color', 'assetId', 'fit', 'paint'].some(key => Reflect.get(override, key) !== undefined))
  return stateOwnsPaint ? resolveComponentBackground(project, surface, state)
    : surface.background?.mode === 'own' ? resolveComponentBackground(project, surface) : undefined
}

/** A disposable render/edit projection. It never becomes an authoring write source. */
export function resolveComponentPresentation(project: CourseProjectV10, surfaceId: string | null, stateId: string | null): CourseProjectV10 {
  const surface = surfaceId ? componentSurface(project, surfaceId) : undefined
  const state = surface?.kind === 'slide' ? surface.presentation?.states.find(value => value.id === stateId) : undefined
  if (!surface || !state) return project
  const instances = { ...project.instances }
  for (const [id, override] of Object.entries(state.overrides)) if (instances[id]) {
    const { frame, ...fields } = override
    const instance = { ...instances[id], ...fields }
    if (frame === null) delete instance.frame
    else if (frame !== undefined) instance.frame = frame
    instances[id] = instance
  }
  const order = state.order?.filter(id => surface.childIds.includes(id))
  const background = resolveComponentSurfaceBackground(project, surface, state)
  const projectedSurface = { ...surface,
    ...(order ? { childIds: [...order, ...surface.childIds.filter(id => !order.includes(id))] } : {}),
    ...(background ? { background: background.paint ? { mode: 'own' as const, paint: background.paint }
      : { mode: 'own' as const, ...background } } : {}),
  }
  const { id: _id, title: _title, childIds, ...container } = projectedSurface
  const containerInstance = instances[surface.id]
  instances[surface.id] = { ...containerInstance, childIds, container }
  return { ...project, instances }
}
