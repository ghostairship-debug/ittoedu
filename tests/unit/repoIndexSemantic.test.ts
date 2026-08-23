import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { generateRepoIndexToDirectory } from '../../scripts/repo-index/generator'
import { readGeneratedDirectory } from '../../scripts/repo-index/writeGenerated'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'ittoedu-repo-index-semantic-'))

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

type StatusClass =
  | 'current-must-preserve'
  | 'current-debt'
  | 'target-acceptance'
  | 'transitional-allowance'

interface SemanticFeature {
  schemaVersion: 1
  id: string
  name: string
  aliases: string[]
  origin: 'semantic'
  statusClass: StatusClass
  owner: string
  moduleIds: string[]
  currentFact: string
  targetState: string
  carriers?: Record<string, string>
  highSignalFiles?: string[]
  highSignalTests?: string[]
  catalogBoundaryFiles?: string[]
  canonicalFiles: string[]
  entrypoints: string[]
  runtimeConsumers: string[]
  tests: string[]
  evidence: string[]
  removalPhase?: string
  reviewGate?: string
}

interface SemanticModule {
  schemaVersion: 1
  id: string
  name: string
  origin: 'semantic'
  status: string
  statusClass: StatusClass
  owner: string
  currentFact: string
  targetState: string
  entrypoints: string[]
  allowedDependencies: string[]
  forbiddenDependencies: string[]
  dependencyPolicyPhase: string
  dependencyPolicyMeaning: string
  evidence: string[]
  removalPhase?: string
  reviewGate?: string
}

interface SemanticCollection<T> {
  schemaVersion: 1
  features?: T[]
  modules?: T[]
  exclusions?: T[]
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, path), 'utf8')) as T
}

function normalizedAlias(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\s_-]+/gu, '')
}

const expectedFeatureIds = [
  'feature:course-project-v9',
  'feature:published-course-v2',
  'feature:editor-core',
  'feature:image-replacement-journey',
  'feature:slide',
  'feature:flow',
  'feature:spatial',
  'feature:media',
  'feature:components',
  'feature:runtime',
  'feature:interactions',
  'feature:global-layers-controller',
  'feature:save-recovery',
  'feature:preview-player',
  'feature:html-web-export',
  'feature:pptx-export',
  'feature:print-export',
  'feature:diagnostics',
  'feature:developer-tab',
  'feature:desktop-ipc',
  'feature:legacy-release',
  'feature:repo-knowledge',
] as const

const expectedModuleIds = [
  'module:shared-contracts',
  'module:editor-core',
  'module:app-persistence',
  'module:surface-slide',
  'module:surface-flow',
  'module:surface-spatial',
  'module:feature-media',
  'module:feature-components',
  'module:runtime-interactions',
  'module:global-layers-controller',
  'module:preview-player',
  'module:export-delivery',
  'module:diagnostics',
  'module:ui-composition',
  'module:main-preload',
  'module:tooling-release',
  'module:repo-knowledge',
] as const

describe('repo-index stable semantic coverage', () => {
  const featureCollection = readJson<SemanticCollection<SemanticFeature>>(
    'repo-index/semantic/features.json',
  )
  const moduleCollection = readJson<SemanticCollection<SemanticModule>>(
    'repo-index/semantic/modules.json',
  )
  const features = featureCollection.features ?? []
  const modules = moduleCollection.modules ?? []

  it('keeps the small complete Feature and Module vocabulary deterministic', () => {
    expect(featureCollection.schemaVersion).toBe(1)
    expect(moduleCollection.schemaVersion).toBe(1)
    expect(features.map(({ id }) => id)).toEqual(expectedFeatureIds)
    expect(modules.map(({ id }) => id)).toEqual(expectedModuleIds)
    expect(features.length).toBeGreaterThanOrEqual(18)
    expect(features.length).toBeLessThanOrEqual(22)
    expect(modules.length).toBeGreaterThanOrEqual(12)
    expect(modules.length).toBeLessThanOrEqual(18)

    const moduleIds = new Set(modules.map(({ id }) => id))
    const aliases = new Map<string, string>()
    for (const feature of features) {
      expect(feature).toMatchObject({
        schemaVersion: 1,
        origin: 'semantic',
        owner: expect.any(String),
        currentFact: expect.any(String),
        targetState: expect.any(String),
      })
      expect(feature.moduleIds.length).toBeGreaterThan(0)
      feature.moduleIds.forEach((moduleId) => expect(moduleIds.has(moduleId), moduleId).toBe(true))
      for (const alias of feature.aliases) {
        const normalized = normalizedAlias(alias)
        expect(normalized.length).toBeGreaterThan(0)
        expect(aliases.get(normalized), `${alias} collides with ${aliases.get(normalized)}`).toBeUndefined()
        aliases.set(normalized, `${feature.id}:${alias}`)
      }
    }

    for (const module of modules) {
      expect(module).toMatchObject({
        schemaVersion: 1,
        origin: 'semantic',
        currentFact: expect.any(String),
        targetState: expect.any(String),
        dependencyPolicyPhase: expect.any(String),
        dependencyPolicyMeaning: 'declared-policy-not-current-import-graph-compliance',
      })
      expect(module.allowedDependencies.length).toBeLessThanOrEqual(8)
      expect(module.forbiddenDependencies.length).toBeLessThanOrEqual(4)
    }
  })

  it('keeps semantic paths real, POSIX-relative, and transitional records gated', () => {
    const statusClasses = new Set<StatusClass>([
      'current-must-preserve',
      'current-debt',
      'target-acceptance',
      'transitional-allowance',
    ])
    const pathFields = [
      'canonicalFiles',
      'entrypoints',
      'runtimeConsumers',
      'tests',
      'evidence',
      'highSignalFiles',
      'highSignalTests',
      'catalogBoundaryFiles',
    ] as const
    for (const record of [...features, ...modules]) {
      expect(statusClasses.has(record.statusClass)).toBe(true)
      if (record.statusClass === 'transitional-allowance') {
        expect(Boolean(record.removalPhase || record.reviewGate), record.id).toBe(true)
      }
      for (const field of pathFields) {
        const values = field in record
          ? (record as unknown as Record<string, string[]>)[field] ?? []
          : []
        for (const path of values) {
          expect(path).not.toMatch(/^[A-Za-z]:[\\/]/)
          expect(path).not.toContain('\\')
          expect(path.startsWith('../')).toBe(false)
          expect(existsSync(resolve(repoRoot, path)), `${record.id}:${field}:${path}`).toBe(true)
        }
      }
    }

    for (const module of modules) {
      for (const dependency of [
        ...module.allowedDependencies,
        ...module.forbiddenDependencies,
      ]) {
        if (!/^(?:src|scripts|repo-index)(?:\/|$)/u.test(dependency)) continue
        expect(existsSync(resolve(repoRoot, dependency)), `${module.id}:${dependency}`).toBe(true)
      }
    }

    const exclusions = readJson<SemanticCollection<Record<string, unknown>>>(
      'repo-index/semantic/exclusions.json',
    ).exclusions ?? []
    expect(exclusions).toContainEqual(expect.objectContaining({
      id: 'exclusion:external-component-source',
    }))
    const components = features.find(({ id }) => id === 'feature:components')
    expect(components?.canonicalFiles.some((path) => path.includes('courseware-components'))).toBe(false)
    expect(components?.canonicalFiles).not.toContain(
      'artifacts/ai-capabilities/component-catalog.snapshot.json',
    )
    for (const feature of features) {
      expect(feature.highSignalFiles?.length ?? 0, `${feature.id}:highSignalFiles`)
        .toBeLessThanOrEqual(8)
      expect(feature.highSignalTests?.length ?? 0, `${feature.id}:highSignalTests`)
        .toBeLessThanOrEqual(6)
      expect(feature.catalogBoundaryFiles?.length ?? 0, `${feature.id}:catalogBoundaryFiles`)
        .toBeLessThanOrEqual(5)
      for (const field of [
        feature.highSignalFiles ?? [],
        feature.highSignalTests ?? [],
        feature.catalogBoundaryFiles ?? [],
      ]) {
        expect(new Set(field).size).toBe(field.length)
      }
    }
  })

  it('keeps sparse journey, compiler, and local Catalog signals evidence-backed', () => {
    const feature = (id: string) => {
      const match = features.find((candidate) => candidate.id === id)
      expect(match, id).toBeDefined()
      return match!
    }

    const journey = feature('feature:image-replacement-journey')
    expect(journey.canonicalFiles).toEqual([
      'src/renderer/App.tsx',
      'src/renderer/store/editorStore.ts',
      'src/renderer/authoring/courseAuthoringSession.ts',
    ])
    expect(journey.highSignalFiles).toEqual(expect.arrayContaining([
      'src/renderer/course/v9MediaAudioCommands.ts',
      'src/renderer/project/v9AssetAdapter.ts',
      'src/renderer/store/history.ts',
      'src/renderer/project/courseProjectIo.ts',
      'src/renderer/project/courseProjectArchive.ts',
    ]))
    expect(journey.highSignalTests).toEqual(expect.arrayContaining([
      'tests/unit/assetTransactions.test.ts',
      'tests/unit/buildPublishedCourseV2.test.ts',
      'tests/integration/imageReplacementRaceCharacterization.test.tsx',
      'tests/e2e/editor.spec.ts',
    ]))

    expect(feature('feature:preview-player').aliases).toContain('activateCourseLocation')
    expect(feature('feature:preview-player').highSignalTests).toEqual(expect.arrayContaining([
      'tests/unit/tryRunLocationMode.test.ts',
      'tests/unit/flowProductIntegration.test.tsx',
      'tests/unit/spatialProductIntegration.test.tsx',
    ]))

    const repoKnowledge = feature('feature:repo-knowledge')
    expect(repoKnowledge.aliases).toEqual(expect.arrayContaining([
      'typecheck',
      'tsconfig',
      'compiler boundary',
    ]))
    expect(repoKnowledge.highSignalFiles).toEqual(expect.arrayContaining([
      'tsconfig.json',
      'tsconfig.electron.json',
      'tsconfig.e2e.json',
      'package.json',
      'repo-index/config.json',
      'scripts/repo-index/typescriptAdapter.ts',
      'tests/setup.ts',
    ]))

    const components = feature('feature:components')
    expect(components.catalogBoundaryFiles).toEqual([
      'artifacts/ai-capabilities/component-catalog.snapshot.json',
      'src/main/componentCatalogManager.ts',
      'src/shared/componentCatalog.ts',
      'src/renderer/components/componentCatalogStatus.ts',
      'src/renderer/ui/ComponentsTab.tsx',
    ])
    expect(components.catalogBoundaryFiles?.some((path) => (
      path.startsWith('../') || path.includes('courseware-components')
    ))).toBe(false)
    expect(components.highSignalTests).toEqual(expect.arrayContaining([
      'tests/unit/componentContentIntegrity.test.ts',
      'tests/integration/componentCatalogV8Matrix.test.ts',
    ]))
  })

  it('keeps Surface, component, and media carriers distinct', () => {
    const feature = (id: string) => {
      const match = features.find((candidate) => candidate.id === id)
      expect(match, id).toBeDefined()
      return match!
    }

    expect(feature('feature:course-project-v9').carriers).toMatchObject({
      project: 'CourseProjectDocument',
      'slide-scene': 'SlideSceneDocument.layerItems (LayerItem[])',
      'flow-paper': 'FlowSurfaceDocument.blocks (FlowBlock[]; not LayerItem[])',
      'spatial-world': 'SpatialSurfaceDocument.world.layerItems (LayerItem[])',
    })

    expect(feature('feature:slide').carriers?.scene).toBe(
      'SlideSceneDocument.layerItems (LayerItem[])',
    )
    expect(feature('feature:spatial').carriers?.world).toBe(
      'SpatialSurfaceDocument.world.layerItems (LayerItem[])',
    )

    const flow = feature('feature:flow').carriers
    expect(flow).toMatchObject({
      paper: 'FlowSurfaceDocument.blocks (FlowBlock[]; not LayerItem[])',
      'paper-component': 'FlowComponentBlock',
      'paper-media': 'FlowMediaBlock',
      overlay: 'FlowSurfaceDocument.surfaceLayerItems (ScopedLayerItem[] -> LayerItem; LayerItem.paperSpace=viewport|paper)',
    })
    expect(flow?.paper).not.toBe(flow?.overlay)
    expect(flow?.paper.startsWith('FlowSurfaceDocument.blocks')).toBe(true)

    expect(feature('feature:components').carriers).toEqual({
      'project-packages': 'CourseProjectDocument.componentPackages + component archive files/runtime bytes',
      'layer-instance': 'ComponentLayerItem for Slide/Spatial/Flow overlay',
      'flow-paper-instance': 'FlowComponentBlock in FlowSurfaceDocument.blocks',
      'shared-instance': 'ScopedLayerItem.item as ComponentLayerItem for global/surface shared',
    })

    const media = feature('feature:media').carriers
    expect(media).toMatchObject({
      metadata: 'CourseProjectDocument.assets (Record<string, AssetMeta>)',
      bytes: 'CourseAssetSidecar.files (Record<string, Uint8Array>)',
      'layer-placement': 'NativeLayerItem.content.data.assetId for Slide/Spatial/Flow overlay',
      'flow-paper-placement': 'FlowMediaBlock.assetId',
    })
    expect(new Set([
      media?.metadata,
      media?.bytes,
      media?.['layer-placement'],
      media?.['flow-paper-placement'],
    ]).size).toBe(4)

    expect(feature('feature:global-layers-controller').carriers).toMatchObject({
      global: 'CourseProjectDocument.globalLayerItems (ScopedLayerItem[])',
      'surface-shared': 'CourseSurfaceDocument.surfaceLayerItems (ScopedLayerItem[])',
      'teacher-controller': 'One global NativeLayerItem(nativeType=teacher-controller)',
    })
  })

  it(
    'validates expanded semantic through generator output in an OS temporary directory',
    () => {
      const outputDirectory = resolve(temporaryRoot, 'generated')
      const summary = generateRepoIndexToDirectory(repoRoot, outputDirectory)
      const generated = readGeneratedDirectory(outputDirectory)
      const manifest = JSON.parse(
        generated.get('manifest.json')!.toString('utf8'),
      ) as Record<string, unknown>

      expect(summary.outputBytes).toBeGreaterThan(0)
      expect(manifest.semanticHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(generated.has('input-inventory.jsonl')).toBe(true)
      expect(outputDirectory.startsWith(resolve(tmpdir()))).toBe(true)
    },
    30_000,
  )
})
