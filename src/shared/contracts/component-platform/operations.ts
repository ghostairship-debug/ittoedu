import type { ComponentFrame } from './frame'
import type { CourseProjectV10, ComponentBackground, ComponentPresentation, ComponentFlowAuthoring, ComponentFlowPlacement, ComponentFlowBodyLayout } from './project'
import type { BehaviorAttachment, ComponentAsset, ComponentContainer, ComponentDefinition, ComponentImplementation, ComponentInstance, ComponentSurface, ComponentSpatialAuthoring, JsonValue } from './project'

/** Software captures actual values read by an operation, including structural dependencies. */
export interface ComponentExpectation {
  path: string[]
  exists: boolean
  value?: JsonValue
}

export type ComponentEdit =
  | { type: 'project.title.set'; title: string }
  | { type: 'project.background.set'; background: ComponentBackground | null }
  | { type: 'project.designTokens.set'; designTokens: CourseProjectV10['designTokens'] | null }
  | { type: 'project.theme.set'; theme: CourseProjectV10['theme'] | null }
  | { type: 'project.playback.set'; playback: CourseProjectV10['playback'] | null }
  | { type: 'project.media.set'; media: CourseProjectV10['media'] | null }
  | { type: 'project.logic.set'; logic: CourseProjectV10['logic'] | null }
  | { type: 'surface.insert'; surface: ComponentSurface; index: number }
  | { type: 'surface.title.set'; surfaceId: string; title: string }
  | { type: 'surface.designSize.set'; surfaceId: string; designSize: { width: number; height: number } | null }
  | { type: 'surface.remove'; surfaceId: string }
  | { type: 'surface.move'; surfaceId: string; index: number }
  | { type: 'surface.background.set'; surfaceId: string; background: ComponentBackground | null }
  | { type: 'surface.presentation.set'; surfaceId: string; presentation: ComponentPresentation | null }
  | { type: 'flow.set'; surfaceId: string; flow: ComponentFlowAuthoring }
  | { type: 'spatial.set'; surfaceId: string; spatial: ComponentSpatialAuthoring }
  | { type: 'definition.set'; definition: ComponentDefinition }
  | { type: 'definition.remove'; definitionId: string }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'asset.add'; asset: ComponentAsset; bytes: Uint8Array }
  /** Preserve asset identity and references while replacing its metadata and bytes together. */
  | { type: 'asset.replace'; asset: ComponentAsset; bytes: Uint8Array; expectedBytes: Uint8Array }
  /** Files and their implementation reference commit in the same document transaction. */
  | { type: 'component.files.set'; ownerId: string; files: Record<string, Uint8Array> | null; expectedFiles: Record<string, Uint8Array> | null }
  | { type: 'data.set'; instanceId: string; path: string[]; value: JsonValue }
  | { type: 'style.set'; instanceId: string; path: string[]; value: JsonValue }
  | { type: 'frame.set'; instanceId: string; frame: ComponentFrame | null }
  | { type: 'instance.patch'; instanceId: string; patch: { name?: string | null; visible?: boolean; locked?: boolean; playbackInitialVisibility?: 'inherit' | 'hidden'; visibility?: ComponentInstance['visibility'] | null } }
  | { type: 'instance.definition.set'; instanceId: string; definitionId: string }
  | { type: 'instance.flowLayout.set'; instanceId: string; flowLayout: ComponentFlowBodyLayout | null }
  | { type: 'instance.flowPlacement.set'; instanceId: string; flowPlacement: ComponentFlowPlacement | null }
  | { type: 'instance.insert'; container: ComponentContainer; index: number; instances: ComponentInstance[]; rootIds: string[] }
  | { type: 'instance.remove'; instanceId: string }
  | { type: 'instance.move'; instanceId: string; container: ComponentContainer; index: number; frame?: ComponentFrame }
  | { type: 'implementation.set'; instanceId: string; implementation: ComponentImplementation | null }
  | { type: 'attachments.set'; instanceId: string; attachments: BehaviorAttachment[] }

export interface ComponentOperationBatch {
  type: 'component-platform.apply'
  edits: ComponentEdit[]
  expected: ComponentExpectation[]
}

/** Describes host-normalized values, rather than echoing submitted edits. */
export interface ComponentAppliedChange {
  path: string[]
  exists: boolean
  value?: JsonValue
}

export interface ComponentAppliedChanges {
  changes: ComponentAppliedChange[]
  affectedTargets: string[]
}
