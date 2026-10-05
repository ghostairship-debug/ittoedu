import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentInstance, JsonValue } from '../../../shared/contracts/component-platform/project'

export interface LibraryDiagnostic { code: string; message: string; instanceId?: string }
export interface LibraryReferences { assetIds?: string[] }
export interface LibraryIdentityMap {
  instances: ReadonlyMap<string, string>
  definitions: ReadonlyMap<string, string>
  assets: ReadonlyMap<string, string>
  components: ReadonlyMap<string, string>
  surfaces: ReadonlyMap<string, string>
}
/** Only the actual definition consumer can identify references inside arbitrary author data/source. */
export interface LibraryReferenceAdapter {
  references(instance: ComponentInstance, definition: ComponentDefinition): LibraryReferences
  rebind(instance: ComponentInstance, identities: LibraryIdentityMap): ComponentInstance
}
export interface LibraryExtractResult { entry: ComponentLibraryEntry; diagnostics: LibraryDiagnostic[] }
export interface LibraryInputValues { [role: string]: JsonValue }
