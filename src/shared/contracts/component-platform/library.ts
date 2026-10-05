import type { ComponentAsset, ComponentDefinition, ComponentInstance } from './project'

/** A reusable author example; software remaps identities when inserting into a project. */
export interface ComponentLibraryEntry {
  schemaVersion: 1
  id: string
  title: string
  definitions: Record<string, ComponentDefinition>
  example: { instances: Record<string, ComponentInstance>; rootIds: string[] }
  assets: Record<string, ComponentAsset>
  resources: { assets: Record<string, Uint8Array>; components: Record<string, Record<string, Uint8Array>> }
  inputs?: { instanceId: string; path: string[]; role: string }[]
}
