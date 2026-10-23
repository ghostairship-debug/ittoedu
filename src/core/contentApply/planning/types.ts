import type { ComponentContainer, ComponentDefinition, ComponentEdit, ComponentFrame, ComponentImplementation, ComponentOperationBatch, CourseProjectV10, JsonObject, JsonValue } from '../../../shared/contracts/component-platform'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import type { HtmlAssemblyDiagnostic } from '../assembly/htmlAssembly'

export type ContentApplyIntent = 'content' | 'insert' | 'style' | 'redo'
export type ContentApplyTarget =
  | { kind: 'instance'; instanceId: string }
  | { kind: 'container'; container: ComponentContainer; index?: number }

/** Created by the file projection reader, never supplied as bookkeeping by a content model. */
export interface HtmlContentProjection {
  html: string
  entries: { instanceId: string; sourcePath: readonly number[] }[]
}

/** Identity-free assembly input. Definition references belong to the software adapter. */
export interface ContentObjectDraft {
  definitionId: string
  name?: string
  flowLayout?: import('../../../shared/contracts/component-platform').ComponentFlowBodyLayout
  viewportPinned?: boolean
  data: JsonValue
  authoring?: import('../../../shared/contracts/component-platform').ComponentAuthoring
  style?: JsonObject
  frame?: ComponentFrame
  implementationOverride?: ComponentImplementation
  children?: ContentObjectDraft[]
}

/** Public input may select a built-in; software resolves its formal definition and defaults. */
export type ContentObjectInput =
  | (Omit<ContentObjectDraft, 'children'> & { children?: ContentObjectInput[] })
  | (Omit<ContentObjectDraft, 'definitionId' | 'data' | 'children'> & { builtinKey: string; data?: JsonValue; children?: ContentObjectInput[] })

export type ContentApplySource =
  | { kind: 'html'; html: string; scope?: 'target' | 'projection'; themeCss?: string; siblingFiles?: ReadonlyMap<string, Uint8Array>;
      /** Software-projected HTML uses canonical asset IDs, outside an instance's private alias namespace. */
      resourceNamespace?: 'project';
      resourceReferences?: ReadonlyMap<string, { bytes: Uint8Array; mediaType: string }>;
      original?: { bytes: Uint8Array; filename: string; mimeType?: string } }
  | { kind: 'objects'; objects: ContentObjectDraft[]; definitions?: ComponentDefinition[];
      /** Source owners are admitted with their instances, never in a second transaction. */
      componentFiles?: Extract<import('../../../shared/contracts/component-platform/operations').ComponentEdit, { type: 'component.files.set' }>[] }
  | { kind: 'data'; fields: { path: string[]; value: JsonValue }[]; implementation?: ComponentImplementation | null;
      /** Software-projected owner files commit with their implementation in the same transaction. */
      componentFiles?: Extract<import('../../../shared/contracts/component-platform/operations').ComponentEdit, { type: 'component.files.set' }>[] }
  | { kind: 'style'; style: JsonObject }

export interface ContentChangeRequest {
  intent: ContentApplyIntent
  target: ContentApplyTarget
  source: ContentApplySource
  /** Source/file preparation findings travel with the same canonical application. */
  diagnostics?: ContentApplyDiagnostic[]
  projection?: HtmlContentProjection
  /** Captured by desktop authoring; never inferred from later focus. */
  editingContext?: { surfaceId: string; stateId: string | null }
  /** Measured editing viewport for content without a fixed authored design size. */
  viewport?: { width: number; height: number }
  /** One-time local design canvas and placement in the destination parent's coordinates.
   * After insert/container redo, only the resulting instances' formal frames persist.
   * Existing-object content/redo keep their current frame; use object.update to resize. */
  region?: ComponentFrame
}

/** Paths are resolved by the project-file adapter; identities remain software-owned. */
export type SurfaceApplyRequest =
  | { intent: 'surface.add'; kind: 'slide' | 'flow' | 'spatial'; title?: string; beforeSurfaceId?: string }
  | { intent: 'surface.add'; pages: { kind: 'slide' | 'flow' | 'spatial'; title?: string; beforeSurfaceId?: string }[] }
  | { intent: 'surface.move'; surfaceId: string; beforeSurfaceId?: string }
  | { intent: 'surface.remove'; surfaceId: string }
  | { intent: 'surface.title'; surfaceId: string; title: string }

/** Software-projected file edits, prepared against the captured document; never a public raw-edit tool. */
export interface CanonicalContentApplyRequest {
  intent: 'canonical'
  edits: ComponentEdit[]
  /** Captured file owner used by the existing Gateway to retain its writable scope. */
  target?: ContentApplyTarget
  editingContext?: { surfaceId: string; stateId: string | null }
  /** Local parser findings accompany the usable content and any retained original. */
  diagnostics?: ContentApplyDiagnostic[]
}

export type ContentApplyRequest = ContentChangeRequest | SurfaceApplyRequest | CanonicalContentApplyRequest

/** A containing canonical batch owns relationship cleanup after all usable plans. */
export interface ContentApplyPlanOptions {
  deferTextRelationships?: boolean
}

export interface ContentApplyDiagnostic extends HtmlAssemblyDiagnostic {
  instanceId?: string
  repairable?: boolean
  file?: string
  line?: number
  column?: number
  lineText?: string
}

export interface ContentApplyPlan {
  command: ComponentOperationBatch
  diagnostics: ContentApplyDiagnostic[]
  usability: 'usable' | 'partial' | 'unusable' | 'unverified'
  /** Retained only for recovery or a later repair; never a second author document. */
  input: ContentApplyRequest
  insertedIds: string[]
}

export interface ContentApplyResult {
  commit: 'committed' | 'unchanged' | 'not_committed' | 'unknown'
  usability: ContentApplyPlan['usability']
  delivery: 'not_requested'
  diagnostics: ContentApplyDiagnostic[]
  input: ContentApplyRequest
  insertedIds: string[]
  receipt?: DocumentOperationResult
}

export interface ContentApplySessionPort {
  /** Return an already captured canonical snapshot; this service does not own one. */
  project(): CourseProjectV10
  resources?(): import('../../../shared/workbench/document').DocumentResources
  dispatch(command: ComponentOperationBatch, signal?: AbortSignal): Promise<DocumentOperationResult>
}
