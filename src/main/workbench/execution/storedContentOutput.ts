import { executionContentOutputSchema } from '../../../shared/workbench/executionDesktop'

/** Read-only normalization of the historical capture label. Targets and authority
 * are unchanged; new submissions still validate against the public content schema. */
export function restoreStoredContentOutput(raw: unknown) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null
  return executionContentOutputSchema.parse(value?.kind === 'replace-text' ? { ...value, kind: 'content' } : raw)
}
