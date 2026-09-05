import type { CourseProjectValidationFindingCodeStatus } from '../courseProjectValidationDiagnostics'

export type CourseProjectFindingConsumer = 'gui' | 'cli' | 'saved-report'

export interface CourseProjectHealthCodeSpec {
  severity: 'error' | 'warning' | 'info'
  status: CourseProjectValidationFindingCodeStatus
  /** Project Health panel. */
  gui: boolean
  /** CLI validate projectHealth / fatal-adjacent findings. */
  cli: boolean
  /** Saved V9 preflight report as project-health:* or the native code. */
  savedReport: boolean
}

/**
 * Enumerated V8→V9 health catalog. Severity, consumers and status are the
 * existing product facts; this table does not decide whether a code is still
 * "meaningful". Schema/archive-shadowed codes stay listed and are not deleted.
 */
export const COURSE_PROJECT_HEALTH_FINDING_CATALOG = {
  'asset-kind-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'asset-reference-analysis-incomplete': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'asset-reference-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'asset-unused': {
    severity: 'info', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'background-asset-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'chart-donut-hole-size-invalid': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'chart-id-duplicate': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'chart-numeric-value-invalid': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'chart-pie-single-series': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'chart-series-points-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'component-package-hash-missing': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'component-package-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'component-package-source-missing': {
    severity: 'info', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'component-package-unused': {
    severity: 'info', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'component-protocol': {
    severity: 'error', status: 'archive-shadowed', gui: false, cli: false, savedReport: false,
  },
  'component-thumbnail-missing': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'component-version-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'controller-button-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'controller-required-for-canvas': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'controller-scene-target-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'controller-state-target-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'controller-visible-while-disabled': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'duplicate-stable-id': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'global-interaction-state-target-partial': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'global-node-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'global-visibility-scene-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'information-release-hidden-self-trigger': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'information-release-hidden-unreachable': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'initial-state-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'input-container-invalid': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'input-rule-family-incomplete': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'input-state-key-invalid': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-action-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'interaction-action-reference-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-animation-self-loop': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-enter-target-initially-visible': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-navigation-not-terminal': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'interaction-node-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'interaction-node-type-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-rule-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'interaction-scene-reference-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'interaction-sound-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'interaction-state-reference-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'line-geometry-shape-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'line-path-degenerate': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'looping-video-ended-unreachable': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'migration-marker': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'node-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'presenter-command-unhandled': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'presenter-f5-browser-reserved': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'presenter-rules-bypassed': {
    severity: 'info', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'presenter-rules-disabled': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'published-interaction-action-unsupported': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'published-interaction-click-unbindable': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'published-interaction-condition-unsupported': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'published-interaction-trigger-unsupported': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'runtime-node-reference-missing': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'runtime-protocol': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'runtime-static-fallback-missing': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'scene-id-duplicate': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'scene-required': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'sound-id-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'state-id-duplicate': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'state-node-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'table-dimension-invalid': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'table-id-duplicate': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'table-matrix-mismatch': {
    severity: 'error', status: 'active', gui: true, cli: true, savedReport: true,
  },
  'thumbnail-state-reference-missing': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'v8-field': {
    severity: 'error', status: 'schema-shadowed', gui: false, cli: false, savedReport: false,
  },
  'video-click-interaction-conflict': {
    severity: 'warning', status: 'active', gui: true, cli: true, savedReport: true,
  },
} as const satisfies Record<string, CourseProjectHealthCodeSpec>

export type CourseProjectHealthCatalogCode =
  keyof typeof COURSE_PROJECT_HEALTH_FINDING_CATALOG

export const COURSE_PROJECT_FORMAT_PREFLIGHT_ADAPTERS = {
  pptx: {
    adapter: 'adaptCoursePptxProducerFindings',
    owner: 'r11-041',
    source: 'src/renderer/export/exportPreflight.ts',
  },
  pdf: {
    adapter: 'adaptCoursePdfProducerFindings',
    owner: 'r11-042',
    source: 'src/renderer/export/exportPreflight.ts',
  },
  htmlWeb: {
    adapter: 'adaptCourseHtmlWebProducerFindings',
    owner: 'r11-043',
    source: 'src/renderer/export/exportPreflight.ts',
  },
} as const
