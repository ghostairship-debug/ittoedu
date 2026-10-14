import type { ComponentAsset, ComponentDefinition, ComponentInstance, ComponentSurface, CourseProjectV10 } from './project'

/** A reusable author example; software remaps identities when inserting into a project. */
export interface ComponentLibraryEntry {
  schemaVersion: 1
  id: string
  title: string
  kind?: 'objects' | 'page' | 'structure'
  definitions: Record<string, ComponentDefinition>
  example: { instances: Record<string, ComponentInstance>; rootIds: string[] }
  assets: Record<string, ComponentAsset>
  resources: { assets: Record<string, Uint8Array>; components: Record<string, Record<string, Uint8Array>> }
  inputs?: { instanceId: string; path: string[]; role: string }[]
  /** Author surfaces and their scoped global content; insertion remaps the entire graph atomically. */
  surfaces?: ComponentSurface[]
  global?: CourseProjectV10['global']
  theme?: CourseProjectV10['theme']
  designTokens?: CourseProjectV10['designTokens']
  logic?: CourseProjectV10['logic']
}
