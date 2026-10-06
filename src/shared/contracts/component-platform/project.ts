import type { FlowTextContent } from '../../document/content'
import type { ComponentFrame } from './frame'
import type { CourseStateDeclaration, CourseStateCondition } from '../course-state/types'
import type { ProjectDesignTokens, CourseTheme } from '../design-v1/types'
import type { ProjectPlaybackSettings } from '../playback-v1/types'
import type { AssetSource, ProjectMediaSettings } from '../media-v1/types'

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
}

/** Authoring identity only. Runtime always resolves the effective implementation. */
export function componentDefinitionBuiltinKey(definition: ComponentDefinition | undefined): string | undefined {
  return definition?.implementation.kind === 'builtin' ? definition.implementation.key : definition?.professionalBuiltinKey
}

export type ComponentTarget =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'project' }

export interface BehaviorAttachment {
  instanceId: string
  target: ComponentTarget
}

export interface ComponentInstance<Data = JsonValue> {
  readonly id: string
  definitionId: string
  name?: string
  visible?: boolean
  visibility?: { mode: 'all' | 'include' | 'exclude'; surfaceIds: string[] }
  locked?: boolean
  playbackInitialVisibility?: 'inherit' | 'hidden'
  flowPlacement?: ComponentFlowPlacement
  flowLayout?: ComponentFlowBodyLayout
  data: Data
  style?: JsonObject
  frame?: ComponentFrame
  /** The sole ownership and ordering relation; parent indexes are derived. */
  childIds?: string[]
  attachments?: BehaviorAttachment[]
  implementationOverride?: ComponentImplementation
}

export interface ComponentBackground {
  mode?: 'inherit' | 'own'
  color?: string
  assetId?: string | null
  fit?: 'cover' | 'contain' | 'fill'
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
  layout: { widthMode?: 'fluid' | 'reading'; readingWidth: number; wideContentWidth: number; paperBackgroundColor?: string }
}
export interface ComponentPresentationState {
  id: string
  title: string
  overrides: Record<string, { data?: JsonValue; style?: JsonObject; frame?: ComponentFrame | null; visible?: boolean }>
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

/** Pose x/y are the viewport center in world coordinates; rotation is degrees. */
export interface ComponentSpatialPose { x: number; y: number; zoom: number; rotation?: number }
export interface ComponentSpatialAuthoring {
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

export interface CourseProjectV10 {
  schemaVersion: 10
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
  surfaces: ComponentSurface[]
  global: { underlay: string[]; overlay: string[] }
  assets: Record<string, ComponentAsset>
}

export type ComponentContainer =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'surface'; surfaceId: string }
  | { kind: 'global'; plane: 'underlay' | 'overlay' }

export function containerChildIds(project: CourseProjectV10, container: ComponentContainer): string[] {
  if (container.kind === 'global') return project.global[container.plane]
  if (container.kind === 'surface') {
    const surface = project.surfaces.find(value => value.id === container.surfaceId)
    if (!surface) throw new Error(`表面已不存在：${container.surfaceId}`)
    return surface.childIds
  }
  const instance = project.instances[container.instanceId]
  if (!instance?.childIds) throw new Error(`容器已不存在：${container.instanceId}`)
  return instance.childIds
}

export function owningContainer(project: CourseProjectV10, instanceId: string): ComponentContainer | null {
  for (const plane of ['underlay', 'overlay'] as const) if (project.global[plane].includes(instanceId)) return { kind: 'global', plane }
  for (const surface of project.surfaces) if (surface.childIds.includes(instanceId)) return { kind: 'surface', surfaceId: surface.id }
  for (const instance of Object.values(project.instances)) if (instance.childIds?.includes(instanceId)) return { kind: 'instance', instanceId: instance.id }
  return null
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

/** One effective paint rule for editors, Player and output. */
export function resolveComponentBackground(project: Pick<CourseProjectV10, 'background'>, surface?: Pick<ComponentSurface, 'background'>, state?: Pick<ComponentPresentationState, 'background'>): { color: string; assetId: string | null; fit: 'cover' | 'contain' | 'fill' } {
  const base = project.background
  const selected = surface?.background?.mode === 'own' ? surface.background : base
  const result = { color: selected?.color ?? '#ffffff', assetId: selected?.assetId ?? null, fit: selected?.fit ?? 'cover' as const }
  const override = state?.background
  if (!override || override.mode === 'inherit') return result
  return { color: override.color ?? result.color, assetId: override.assetId === undefined ? result.assetId : override.assetId,
    fit: override.fit ?? result.fit }
}

/** A disposable render/edit projection. It never becomes an authoring write source. */
export function resolveComponentPresentation(project: CourseProjectV10, surfaceId: string | null, stateId: string | null): CourseProjectV10 {
  const surface = project.surfaces.find(value => value.id === surfaceId)
  const state = surface?.presentation?.states.find(value => value.id === stateId)
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
  const projectedSurface = { ...surface,
    ...(order ? { childIds: [...order, ...surface.childIds.filter(id => !order.includes(id))] } : {}),
    ...(state.background ? { background: { mode: 'own' as const, ...resolveComponentBackground(project, surface, state) } } : {}),
  }
  return { ...project, instances, surfaces: project.surfaces.map(value => value.id === surfaceId ? projectedSurface : value) }
}
