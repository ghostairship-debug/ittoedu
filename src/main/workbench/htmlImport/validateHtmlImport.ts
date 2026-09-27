import type { ExtractHtmlResourcesResult, ImportDiagnostic } from './types'
import { remoteReferenceDiagnostic } from './remoteHtmlReferences'

export function validateHtmlImport(result: ExtractHtmlResourcesResult): ImportDiagnostic[] {
  return [...result.diagnostics, ...result.remoteReferences.map(remoteReferenceDiagnostic)]
}
