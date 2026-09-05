import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createRectangleNode } from '@/renderer/project/nativeNodeFactories'
import {
  COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
  COURSE_PROJECT_VALIDATION_FATAL_CODES,
  COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
  resolveSchemaValidCourseProjectDiagnosticTarget,
} from '@/shared/courseProjectValidationDiagnostics'
import { COURSE_PROJECT_HEALTH_FINDING_CATALOG } from '@/shared/courseProjectHealth'
import { PROJECT_HEALTH_CODES } from '@/shared/diagnosticCodes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'

function projectWithSceneLayer() {
  const project = createBlankCourseProject({
    includeDefaultController: false,
    controls: 'none',
  })
  const surface = project.surfaces[0]
  if (surface?.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected slide scene')
  const item = sceneNodeToCourseLayerItem(createRectangleNode({
    id: 'diagnostic-layer',
    name: '诊断图层',
  }), 0)
  scene.layerItems.push(item)
  return { project, surface, scene, item }
}

describe('Course Project Validation DiagnosticTarget V1', () => {
  it('resolves array paths to stable V9 ids without retaining indexes', () => {
    const { project, surface, scene, item } = projectWithSceneLayer()

    const target = resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      path: ['surfaces', 0, 'scenes', 0, 'layerItems', 0, 'frame'],
    })

    expect(target).toEqual({
      version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
      kind: 'layer-item',
      owner: 'scene',
      projectId: project.id,
      surfaceId: surface.id,
      sceneId: scene.id,
      layerItemId: item.layerItemId,
    })
    expect(JSON.stringify(target)).not.toContain('layerItems')
    expect(JSON.stringify(target)).not.toContain(':0')
  })

  it('uses finding metadata and falls back to the project for stale hints', () => {
    const { project, surface, item } = projectWithSceneLayer()

    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      layerItemId: item.layerItemId,
    })).toMatchObject({
      version: 1,
      kind: 'layer-item',
      owner: 'scene',
      layerItemId: item.layerItemId,
    })
    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      surfaceId: surface.id,
    })).toEqual({
      version: 1,
      kind: 'surface',
      projectId: project.id,
      surfaceId: surface.id,
    })
    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      path: ['surfaces', 999, 'scenes', 999],
      surfaceId: 'stale-surface',
      layerItemId: 'stale-layer',
    })).toEqual({
      version: 1,
      kind: 'project',
      projectId: project.id,
    })
  })

  it('resolves a nested Flow block from the schema stable-id path', () => {
    const { project } = projectWithSceneLayer()
    project.surfaces.push({
      id: 'diagnostic-flow',
      title: '诊断讲义',
      type: 'flow',
      backgroundColor: '#ffffff',
      surfaceLayerItems: [],
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      blocks: [{
        id: 'flow-section',
        type: 'section',
        title: '诊断小节',
        collapsedByDefault: false,
        blocks: [{ id: 'flow-section-note', type: 'paragraph', text: '嵌套正文' }],
      }],
    })

    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      path: ['surfaces', 1, 'blocks', 'flow-section-note', 'text'],
    })).toEqual({
      version: 1,
      kind: 'flow-block',
      projectId: project.id,
      surfaceId: 'diagnostic-flow',
      blockId: 'flow-section-note',
    })
  })

  it('falls back to project when layer metadata is ambiguous', () => {
    const { project, surface, item } = projectWithSceneLayer()
    project.globalLayerItems.push({
      item: structuredClone(item),
      visibility: { mode: 'all', locationIds: [] },
    })

    expect(resolveSchemaValidCourseProjectDiagnosticTarget(project, {
      layerItemId: item.layerItemId,
      surfaceId: surface.id,
    })).toEqual({
      version: 1,
      kind: 'project',
      projectId: project.id,
    })
  })

  it('enumerates the complete report code surface with honest reachability', () => {
    expect(COURSE_PROJECT_VALIDATION_FATAL_CODES).toEqual([
      'archive-invalid',
      'input-unreadable',
      'schema-invalid',
      'unsupported-project-version',
      'usage-error',
      'validation-failed',
    ])
    expect(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.map(({ code }) => code)).toEqual([
      'asset-byte-length-mismatch',
      'asset-bytes-missing',
      'asset-kind-mismatch',
      'asset-metadata-missing',
      'asset-reference-analysis-incomplete',
      'asset-reference-missing',
      'asset-unused',
      'background-asset-missing',
      'chart-donut-hole-size-invalid',
      'chart-id-duplicate',
      'chart-numeric-value-invalid',
      'chart-pie-single-series',
      'chart-series-points-mismatch',
      'component-asset-bytes-missing',
      'component-bytes-missing',
      'component-hash-mismatch',
      'component-manifest-identity-mismatch',
      'component-metadata-missing',
      'component-package-hash-missing',
      'component-package-missing',
      'component-package-source-missing',
      'component-package-unused',
      'component-protocol',
      'component-thumbnail-missing',
      'component-version-missing',
      'controller-button-id-duplicate',
      'controller-required-for-canvas',
      'controller-scene-target-missing',
      'controller-state-target-missing',
      'controller-visible-while-disabled',
      'duplicate-stable-id',
      'global-interaction-state-target-partial',
      'global-node-id-duplicate',
      'global-visibility-scene-reference-missing',
      'information-release-hidden-self-trigger',
      'information-release-hidden-unreachable',
      'initial-state-reference-missing',
      'input-container-invalid',
      'input-rule-family-incomplete',
      'input-state-key-invalid',
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
      'line-geometry-shape-mismatch',
      'line-path-degenerate',
      'looping-video-ended-unreachable',
      'migration-marker',
      'node-id-duplicate',
      'online-connect-origin-undeclared',
      'online-connect-origin-unresolved',
      'online-remote-asset',
      'online-remote-url-invalid',
      'player-bundle-empty',
      'presenter-command-unhandled',
      'presenter-f5-browser-reserved',
      'presenter-rules-bypassed',
      'presenter-rules-disabled',
      'project-schema-invalid',
      'published-interaction-action-unsupported',
      'published-interaction-click-unbindable',
      'published-interaction-condition-unsupported',
      'published-interaction-trigger-unsupported',
      'runtime-node-reference-missing',
      'runtime-protocol',
      'runtime-static-fallback-missing',
      'scene-id-duplicate',
      'scene-required',
      'sound-id-mismatch',
      'state-id-duplicate',
      'state-node-reference-missing',
      'static-export-info',
      'static-export-interactions-omitted',
      'static-export-preflight',
      'static-export-warning',
      'table-dimension-invalid',
      'table-id-duplicate',
      'table-matrix-mismatch',
      'thumbnail-state-reference-missing',
      'v8-field',
      'video-click-interaction-conflict',
    ])
    expect(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.filter(
      ({ status }) => status === 'active',
    ).map(({ code }) => code)).toEqual([
      'asset-kind-mismatch',
      'asset-reference-analysis-incomplete',
      'asset-reference-missing',
      'asset-unused',
      'background-asset-missing',
      'chart-donut-hole-size-invalid',
      'chart-id-duplicate',
      'chart-numeric-value-invalid',
      'chart-pie-single-series',
      'chart-series-points-mismatch',
      'component-package-hash-missing',
      'component-package-source-missing',
      'component-package-unused',
      'component-thumbnail-missing',
      'controller-required-for-canvas',
      'controller-scene-target-missing',
      'controller-state-target-missing',
      'controller-visible-while-disabled',
      'duplicate-stable-id',
      'global-interaction-state-target-partial',
      'information-release-hidden-self-trigger',
      'information-release-hidden-unreachable',
      'input-container-invalid',
      'input-rule-family-incomplete',
      'input-state-key-invalid',
      'interaction-action-reference-missing',
      'interaction-animation-self-loop',
      'interaction-enter-target-initially-visible',
      'interaction-node-type-mismatch',
      'interaction-scene-reference-missing',
      'interaction-state-reference-missing',
      'line-geometry-shape-mismatch',
      'line-path-degenerate',
      'looping-video-ended-unreachable',
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
      'scene-id-duplicate',
      'sound-id-mismatch',
      'static-export-interactions-omitted',
      'table-dimension-invalid',
      'table-id-duplicate',
      'table-matrix-mismatch',
      'video-click-interaction-conflict',
    ])
    expect(new Set(COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.map(
      ({ status }) => status,
    ))).toEqual(new Set([
      'active',
      'schema-shadowed',
      'archive-shadowed',
      'upstream-filtered',
    ]))
    const ledgerCodes = new Set(
      COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.map(({ code }) => code),
    )
    for (const code of PROJECT_HEALTH_CODES) {
      expect(ledgerCodes.has(code), `V8 health code missing from V9 catalog: ${code}`).toBe(true)
    }
    for (const [code, spec] of Object.entries(COURSE_PROJECT_HEALTH_FINDING_CATALOG)) {
      const entry = COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER.find((item) => item.code === code)
      expect(entry, `health catalog code missing from ledger: ${code}`).toBeDefined()
      expect(entry?.status).toBe(spec.status)
    }
  })
})
