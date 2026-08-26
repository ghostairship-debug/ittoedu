/** Authoritative, type-safe diagnostic codes consumed by UI and AI tooling. */
export const PROJECT_HEALTH_CODES = [
  'asset-kind-mismatch',
  'asset-reference-analysis-incomplete',
  'asset-reference-missing',
  'asset-unused',
  'component-package-hash-missing',
  'component-package-missing',
  'component-package-source-missing',
  'component-package-unused',
  'component-thumbnail-missing',
  'component-version-missing',
  'controller-button-id-duplicate',
  'controller-required-for-canvas',
  'controller-scene-target-missing',
  'controller-state-target-missing',
  'controller-visible-while-disabled',
  'global-interaction-state-target-partial',
  'global-node-id-duplicate',
  'global-visibility-scene-reference-missing',
  'information-release-hidden-self-trigger',
  'information-release-hidden-unreachable',
  'initial-state-reference-missing',
  'interaction-action-id-duplicate',
  'interaction-action-reference-missing',
  'interaction-animation-self-loop',
  'interaction-enter-target-initially-visible',
  'interaction-navigation-not-terminal',
  'interaction-node-reference-missing',
  'interaction-node-type-mismatch',
  'interaction-rule-id-duplicate',
  'interaction-scene-reference-missing',
  'interaction-sound-reference-missing',
  'interaction-state-reference-missing',
  'looping-video-ended-unreachable',
  'node-id-duplicate',
  'presenter-command-unhandled',
  'presenter-f5-browser-reserved',
  'presenter-rules-bypassed',
  'presenter-rules-disabled',
  'published-interaction-action-unsupported',
  'published-interaction-click-unbindable',
  'published-interaction-condition-unsupported',
  'published-interaction-trigger-unsupported',
  'runtime-node-reference-missing',
  'runtime-static-fallback-missing',
  'scene-required',
  'scene-id-duplicate',
  'sound-id-mismatch',
  'state-id-duplicate',
  'state-node-reference-missing',
  'thumbnail-state-reference-missing',
  'video-click-interaction-conflict',
] as const

export type ProjectHealthCode = typeof PROJECT_HEALTH_CODES[number]

export const NATIVE_EXPORT_PREFLIGHT_CODES = [
  'asset-bytes-missing',
  'asset-unused-summary',
  'component-bytes-missing',
  'component-external-network',
  'component-external-url-reference',
  'component-hash-mismatch',
  'controller-interactive-obstruction',
  'formula-content-overflow',
  'formula-content-overflow-estimated',
  'formula-layout-check-failed',
  'formula-low-contrast',
  'image-hard-edge-review',
  'image-safe-area-review',
  'node-fully-outside-canvas',
  'node-partially-outside-canvas',
  'pptx-formula-rasterized',
  'pptx-text-emphasis-rasterized',
  'runtime-external-network',
  'runtime-external-url-reference',
  'scene-appears-blank',
  'static-export-audio-omitted',
  'static-export-controller-omitted',
  'static-export-interactions-omitted',
  'static-export-video-poster',
  'text-content-overflow',
  'text-content-overflow-estimated',
  'text-font-size-below-recommended',
  'text-font-size-near-minimum',
  'text-font-unavailable',
  'text-layout-check-failed',
  'text-low-contrast',
  'visual-density-high',
  'visual-overlap-heuristic',
] as const

export type NativeExportPreflightCode =
  typeof NATIVE_EXPORT_PREFLIGHT_CODES[number]

export type ExportPreflightCode =
  | NativeExportPreflightCode
  | `project-health:${ProjectHealthCode}`

export function isProjectHealthCode(value: string): value is ProjectHealthCode {
  return (PROJECT_HEALTH_CODES as readonly string[]).includes(value)
}

export function isExportPreflightCode(value: string): value is ExportPreflightCode {
  if ((NATIVE_EXPORT_PREFLIGHT_CODES as readonly string[]).includes(value)) return true
  return value.startsWith('project-health:') &&
    isProjectHealthCode(value.slice('project-health:'.length))
}
