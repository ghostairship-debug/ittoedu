import type { ComponentAsset, ComponentDefinition, ComponentInstance, ComponentSurface, CourseProjectV10 } from './project'
import type { ComponentNavigationTransition } from './navigationMotion'

/** Purpose and host conditions supplement the existing content/behavior role and objects/page/structure kind. */
export interface ComponentLibraryUsage {
  kind: 'container' | 'program' | 'presentation' | 'camera' | 'background' | 'transition' | 'template' | 'content'
  host?: 'any' | 'container' | 'spatial' | 'navigation'
  placement?: 'content' | 'underlay' | 'overlay'
  description?: string
  editable?: Array<'parameters' | 'structure' | 'source'>
  /** Attached to an actual navigation action by the ordinary insertion planner. */
  transition?: ComponentNavigationTransition
}

/** A reusable author example; software remaps identities when inserting into a project. */
export interface ComponentLibraryEntry {
  schemaVersion: 2
  id: string
  title: string
  kind?: 'objects' | 'page' | 'structure'
  definitions: Record<string, ComponentDefinition>
  example: { instances: Record<string, ComponentInstance>; rootIds: string[] }
  assets: Record<string, ComponentAsset>
  resources: { assets: Record<string, Uint8Array>; components: Record<string, Record<string, Uint8Array>> }
  inputs?: { instanceId: string; path: string[]; role: string }[]
  usage?: ComponentLibraryUsage
  global?: CourseProjectV10['global']
  theme?: CourseProjectV10['theme']
  designTokens?: CourseProjectV10['designTokens']
  logic?: CourseProjectV10['logic']
}

/** Accepted at the existing library archive read boundary, never written by new exports. */
export interface LegacyComponentLibraryEntry extends Omit<ComponentLibraryEntry, 'schemaVersion' | 'usage'> {
  schemaVersion: 1
  surfaces?: ComponentSurface[]
}

export type ComponentLibraryInput = ComponentLibraryEntry | LegacyComponentLibraryEntry
