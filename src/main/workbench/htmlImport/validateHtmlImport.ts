import type { ExtractHtmlResourcesResult, ImportDiagnostic } from './types'

export function validateHtmlImport(result: ExtractHtmlResourcesResult): ImportDiagnostic[] {
  const errors = result.diagnostics.filter(diagnostic => diagnostic.level === 'error')
  for (const remote of result.remoteReferences) {
    if (remote.context !== 'js-string') errors.push({ level: 'error', code: 'remote-resource', message: `未授权远程资源 ${remote.url}`, reference: remote.url })
  }
  return errors
}
