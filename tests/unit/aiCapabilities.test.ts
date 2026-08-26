import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  AI_CAPABILITY_INDEX_MAX_BYTES,
  assertIndexWithinLimit,
  canonicalJsonByteLength,
  checkAiCapabilityArtifacts,
  COURSE_NATIVE_TYPES,
  generateAiCapabilityArtifacts,
  INTERACTION_PROTOCOL_VERSION,
  writeAiCapabilityArtifacts,
} from '../../scripts/generate-ai-capabilities'
import { BUILT_IN_COMPONENT_CATALOG_SHA256 } from '../../src/shared/builtInComponentCatalog'
import { componentManifestSchema } from '../../src/shared/componentSchema'
import {
  COMPONENT_RUNTIME_API_VERSION,
  COMPONENT_SCHEMA_VERSION,
  RUNTIME_API_VERSION,
} from '../../src/shared/constants'
import { COURSE_PROJECT_SCHEMA_VERSION } from '../../src/shared/courseProjectTypes'
import {
  COURSE_PROJECT_DIAGNOSTIC_TARGET_KINDS,
  COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
  COURSE_PROJECT_VALIDATION_FATAL_CODES,
  COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
} from '../../src/shared/courseProjectValidationDiagnostics'
import {
  NATIVE_EXPORT_PREFLIGHT_CODES,
  PROJECT_HEALTH_CODES,
} from '../../src/shared/diagnosticCodes'
import {
  INTERACTION_ACTION_TYPES,
  INTERACTION_CONDITION_TYPES,
  INTERACTION_TRIGGER_TYPES,
} from '../../src/shared/interactionTypes'
import {
  PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
} from '../../src/shared/publishedInteractionSupport'
import { PUBLISHED_COURSE_VERSION } from '../../src/shared/publishedCourseTypes'
import { SURFACE_RUNTIME_API_VERSION } from '../../src/shared/surfaceRuntimeTypes'

const expectedCatalogPackageCount = 4
const siblingCatalogAvailable = existsSync(
  path.join(process.cwd(), '..', 'courseware-components', 'catalog.json'),
)
const expectedProvenanceEntrypoints = [
  'scripts/generate-ai-capabilities.ts',
  'src/shared/courseProjectSchema.ts',
  'src/shared/publishedCourseSchema.ts',
]
const expectedCurrentProtocols = {
  project: COURSE_PROJECT_SCHEMA_VERSION,
  publishedCourse: PUBLISHED_COURSE_VERSION,
  runtime: [RUNTIME_API_VERSION, SURFACE_RUNTIME_API_VERSION],
  component: COMPONENT_SCHEMA_VERSION,
  interaction: INTERACTION_PROTOCOL_VERSION,
} as const

function parseFile<T>(
  files: ReadonlyMap<string, string>,
  relativePath: string,
): T {
  const source = files.get(relativePath)
  expect(source, `${relativePath} should be generated`).toBeDefined()
  return JSON.parse(source!) as T
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function createTemporaryDirectory(label: string): Promise<string> {
  const root = path.join(process.cwd(), 'tmp')
  await fs.mkdir(root, { recursive: true })
  return fs.mkdtemp(path.join(root, `${label}-`))
}

async function removeTemporaryDirectory(directory: string): Promise<void> {
  await fs.rm(directory, { recursive: true, force: true })
}

describe('AI capability manifest generation', () => {
  it('is byte-deterministic and keeps the index small when the catalog is absent', async () => {
    const missingCatalog = path.resolve(
      process.cwd(),
      'tests',
      '__missing-ai-capability-catalog__',
    )
    const options = {
      componentCatalogRoot: missingCatalog,
      componentCatalogLabel: 'test-fixture/missing-catalog',
    }
    const first = await generateAiCapabilityArtifacts(options)
    const second = await generateAiCapabilityArtifacts(options)

    expect([...second.files.entries()]).toEqual([...first.files.entries()])
    const index = parseFile<{
      nodes: Array<{ type: string; schema: string; schemaRole: string }>
      publishedCourse: string
      publishedCourseRole: string
      publishedCourseValidationAuthority: string
      interactions: {
        triggerTypes: string[]
        conditionTypes: string[]
        actionTypes: string[]
        publishedPlayback: Record<string, unknown>
        courseLogicAuthoring: Record<string, string>
      }
      validation: {
        command: string
        output: string
        reportVersion: number
        contract: string
        findingCodeLedger: string
        diagnosticTargetVersion: number
        schemaInvalid: Record<string, unknown>
        semanticCoverage: string
        checks: string[]
        exitCodes: Record<string, number>
        execution: string
      }
      components: {
        packageAdmission: Record<string, unknown>
        exports: { singleHtml: string; webPackage: string; pdf: string; pptx: string }
        publishedPlayback: {
          status: string
          provenSlices: Array<Record<string, unknown>>
          staticExport: Record<string, string>
          notCovered: string[]
        }
      }
      assessmentEvaluators: Array<{
        id: string
        status: string
        authorities: string[]
        responseTypes: string[]
        invocation: { module: string; export: string; runtime: string }
      }>
      headlessBuild: {
        language: string
        runner: string
        entrypoints: Record<string, string>
        output: string
        constraints: string[]
      }
      runtime: {
        exports: { singleHtml: string; webPackage: string; pdf: string; pptx: string }
      }
      exportSurfaces: {
        singleHtml: {
          resources: string
          modes: { offlinePortable: string; onlineLightweight: string }
          networkPolicy: string
        }
        pdf: { interactivity: string; representation: string }
        pptx: { interactivity: string; representation: string }
      }
      previewSurfaces: {
        host: string
        consumers: string[]
        resources: Record<string, string>
        networkPolicy: {
          declaredConnectOrigins: string[]
          enforcement: string
          leaseLifetime: string
          corsTls: string
          remoteScripts: string
        }
      }
    }>(first.files, 'index.json')
    expect(first.indexBytes).toBeLessThanOrEqual(AI_CAPABILITY_INDEX_MAX_BYTES)
    expect(first.indexBytes).toBe(canonicalJsonByteLength(index))
    expect(index.nodes.map((entry) => entry.type)).toEqual([
      ...COURSE_NATIVE_TYPES,
    ])
    expect(index.nodes.map((entry) => entry.type)).not.toContain('external-component')
    expect(index.nodes.every((entry) =>
      entry.schema.includes('#/nativeTypeSchemas/') &&
      entry.schemaRole === 'builder-capability-summary',
    )).toBe(true)
    expect(index.publishedCourse).toBe('schemas/published-course-v2.json')
    expect(index.publishedCourseRole).toBe('builder-capability-summary')
    expect(index.publishedCourseValidationAuthority).toBe(
      'src/shared/publishedCourseSchema.ts#publishedCourseV2Schema',
    )
    expect(index.interactions.triggerTypes).toEqual(INTERACTION_TRIGGER_TYPES)
    expect(index.interactions.conditionTypes).toEqual(INTERACTION_CONDITION_TYPES)
    expect(index.interactions.actionTypes).toEqual(INTERACTION_ACTION_TYPES)
    expect(index.interactions.publishedPlayback).toEqual(
      PUBLISHED_INTERACTION_PLAYBACK_SUPPORT,
    )
    expect(index.interactions.courseLogicAuthoring).toEqual({
      courseState: 'professional-gui-and-undoable-commands',
      navigationGuards: 'professional-gui-and-undoable-commands',
      commitValidation: 'full-course-project-v9-schema',
    })
    expect(parseFile<{ publishedPlayback: Record<string, unknown> }>(
      first.files,
      'schemas/interactions.json',
    ).publishedPlayback).toEqual(PUBLISHED_INTERACTION_PLAYBACK_SUPPORT)
    expect(index.assessmentEvaluators).toEqual([
      expect.objectContaining({
        id: 'EVAL-finite-choice-v1',
        status: 'stable',
        authorities: ['finite-auto'],
        responseTypes: ['choice'],
        invocation: {
          module: 'src/shared/assessmentEvaluators.ts',
          export: 'evaluateAssessment',
          runtime: 'ctx.assessment.evaluate',
        },
      }),
      expect.objectContaining({
        id: 'EVAL-normalized-short-v1',
        status: 'stable',
        authorities: ['normalized-auto'],
        responseTypes: ['normalized-short'],
        invocation: {
          module: 'src/shared/assessmentEvaluators.ts',
          export: 'evaluateAssessment',
          runtime: 'ctx.assessment.evaluate',
        },
      }),
    ])
    expect(index.validation).toMatchObject({
      command: 'npm run --silent validate:course-project -- <project.h5lesson>',
      input: 'Course Project V9 .h5lesson',
      output: 'stable-json',
      reportVersion: 1,
      contract: 'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
      findingCodeLedger: 'diagnostics.json#/courseProjectValidation/findingCodes',
      diagnosticTargetVersion: 1,
      schemaInvalid: {
        status: 'unreadable',
        exitCode: 2,
        semanticSections: 'all-null',
        canExport: false,
      },
      semanticCoverage: 'current-wired-only-see-code-ledger',
      checks: [
        'course-project-v9-schema',
        'assets-and-components',
        'runtime-component-protocol',
        'single-html-preflight',
        'web-package-preflight',
        'pdf-preflight',
        'pptx-preflight',
        'stable-ids',
        'no-v8-fields-or-migration-markers',
        'v9-project-health-runtime-interaction-component-controller-media',
      ],
      exitCodes: {
        valid: 0,
        diagnosedErrors: 1,
        unreadableOrUsageError: 2,
      },
      execution: 'node-only-no-electron-no-export-no-write',
    })
    expect(index.validation.checks).toContain(
      'v9-project-health-runtime-interaction-component-controller-media',
    )

    const diagnostics = parseFile<{
      artifactVersion: number
      legacyV8: {
        scope: string
        registryVersion: number
        projectHealth: string[]
        nativeExportPreflight: string[]
        projectedProjectHealthForExport: string[]
        sourceOfTruth: string
      }
      courseProjectValidation: {
        reportVersion: number
        target: {
          version: number
          stableIdentity: string
          kinds: string[]
          unresolvedFallback: string
          schemaInvalid: string
        }
        fatalCodes: string[]
        schemaIssueCodes: string
        findingCodes: unknown[]
        projectHealth: Record<string, unknown>
        sourceOfTruth: string
        contract: string
      }
    }>(first.files, 'diagnostics.json')
    expect(diagnostics.artifactVersion).toBe(2)
    expect(diagnostics.legacyV8).toEqual({
      scope: expect.stringContaining('not the active Course Project V9 CLI'),
      registryVersion: 1,
      projectHealth: PROJECT_HEALTH_CODES.filter(
        (code) => !code.startsWith('published-interaction-'),
      ),
      nativeExportPreflight: NATIVE_EXPORT_PREFLIGHT_CODES,
      projectedProjectHealthForExport: PROJECT_HEALTH_CODES
        .filter((code) => !code.startsWith('published-interaction-'))
        .map((code) => `project-health:${code}`),
      sourceOfTruth: 'src/shared/diagnosticCodes.ts',
    })
    expect(diagnostics).not.toHaveProperty('projectHealth')
    expect(diagnostics).not.toHaveProperty('nativeExportPreflight')
    expect(diagnostics.courseProjectValidation).toEqual({
      reportVersion: 1,
      target: {
        version: COURSE_PROJECT_DIAGNOSTIC_TARGET_VERSION,
        stableIdentity: 'course-project-v9-ids-only',
        kinds: COURSE_PROJECT_DIAGNOSTIC_TARGET_KINDS,
        unresolvedFallback: 'project',
        schemaInvalid: 'omitted',
      },
      fatalCodes: COURSE_PROJECT_VALIDATION_FATAL_CODES,
      schemaIssueCodes: 'zod-issue-code',
      findingCodes: COURSE_PROJECT_VALIDATION_FINDING_CODE_LEDGER,
      projectHealth: {
        collector: 'collectCourseProjectHealth',
        input: 'schema-valid-course-project-v9-plus-opened-archive-files',
        ordering: 'severity-path-code-message',
        target: 'required-diagnostic-target-v1',
        readOnly: true,
        domains: [
          {
            id: 'runtime',
            collector: 'collectCourseProjectRuntimeHealth',
            source: 'src/shared/courseProjectHealth/runtime.ts',
          },
          {
            id: 'interaction',
            collector: 'collectCourseProjectInteractionHealth',
            source: 'src/shared/courseProjectHealth/interaction.ts',
          },
          {
            id: 'component',
            collector: 'collectCourseProjectComponentHealth',
            source: 'src/shared/courseProjectHealth/component.ts',
          },
          {
            id: 'controller-media',
            collector: 'collectCourseProjectControllerMediaHealth',
            source: 'src/shared/courseProjectHealth/controllerMedia.ts',
          },
        ],
        networkDeclarationParity: 'deferred',
      },
      sourceOfTruth: 'src/shared/courseProjectValidationDiagnostics.ts',
      contract: 'docs/contracts/COURSE_PROJECT_VALIDATION_REPORT_V1.md',
    })
    expect(index.components.packageAdmission).toEqual({
      requiredAvailability: 'available',
      allowedQualitiesForRelease: ['stable'],
      experimentalRequiresExplicitCaseApproval: true,
      releaseBlockersMustBeEmpty: true,
      licenseStatusMustBe: 'verified',
      maintainerMustBeAssigned: true,
    })
    expect(index.components.exports).toMatchObject({
      singleHtml: 'partial:local-dom-carriers-plus-slide-scene-phaser-interactive; global-component-session-lifetime-not-covered',
      webPackage: 'partial:local-dom-carriers-plus-slide-scene-phaser-interactive; global-component-session-lifetime-not-covered',
      pdf: 'pure-slide-real-published-capture; other-surfaces-static-fallback-or-label',
      pptx: 'slide-real-published-capture-with-authored-fallback-or-visible-placeholder; global-only-in-pure-slide',
    })
    expect(index.components.publishedPlayback).toEqual({
      status: 'partial',
      provenSlices: [
        {
          surfaces: ['slide', 'flow', 'spatial-2d'],
          carriers: [
            'slide:scene.layerItems/surfaceLayerItems',
            'flow:blocks/surfaceLayerItems',
            'spatial-2d:world.layerItems/surfaceLayerItems',
          ],
          scope: 'local-only',
          renderMode: 'dom',
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          behavior: 'interactive-component-api4-playback',
          services: 'shared-courseState; active-carrier host actions; cross-location go-next-previous guarded; replay same-location; restart bypasses guards and resets defaults',
        },
        {
          surface: 'slide',
          carrier: 'scene.layerItems',
          scope: 'scene-local',
          renderMode: 'phaser',
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          behavior: 'interactive-component-api4-playback',
          services: 'shared-courseState; active-carrier host actions; cross-location go-next-previous guarded; replay same-location; restart bypasses guards and resets defaults',
        },
      ],
      staticExport: {
        pdf: 'pure-slide-page-capture-runs-dom-scene-surface-global-and-phaser-scene; mixed-flow-spatial-use-static-fallback-or-label',
        pptx: 'slide-dom-scene-surface-and-phaser-scene-real-item-capture; global-dom-only-in-pure-slide; failure-uses-authored-fallback-or-visible-placeholder',
      },
      notCovered: [
        'global-component-session-lifetime-and-scope-parity',
        'dom-ctx.events-course-bus',
        'presentation-outside-slide',
        'phaser-global-or-surface-shared',
        'phaser-flow-or-spatial',
        'hybrid-published-parity',
        'mixed-pdf-slide-dynamic-capture',
        'flow-or-spatial-dynamic-capture-pdf-or-pptx',
        'declarative-component.event-trigger',
      ],
    })
    expect(index.runtime.exports).toMatchObject({
      singleHtml: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
      webPackage: 'partial:slide-scene-api2-dom-phaser-hybrid-plus-slide-scene-flow-surface-api3-dom-interactive',
      pdf: 'pure-slide-real-published-page-capture; mixed-slide-static-composition; flow-spatial-static-representation',
      pptx: 'enabled-slide-scene-api2-api3-real-item-capture; enabled-global-api2-only-in-pure-slide; authored-fallback-or-visible-placeholder-otherwise',
    })
    expect(index.exportSurfaces.singleHtml).toEqual({
      interactivity: 'preserved',
      resources: 'selectable-inline-or-declared-remote',
      modes: {
        offlinePortable: 'all-published-assets-inline',
        onlineLightweight: 'referenced-project-assets-with-remote-url-remote-others-inline; saved-bytes-required-at-build-even-for-remote-delivery',
      },
      networkPolicy: 'exact-declared-origins-no-remote-script',
    })
    expect(index.exportSurfaces.pdf).toEqual({
      interactivity: 'omitted',
      representation: 'pure-slide-published-capture-plus-mixed-flow-spatial-static-rendering',
    })
    expect(index.exportSurfaces.pptx).toEqual({
      interactivity: 'omitted',
      representation: 'slide-native-editable-plus-published-dynamic-capture-with-explicit-fallback',
    })
    expect(index.previewSurfaces).toEqual({
      host: 'main-renderer-published-v2',
      consumers: ['current-location-try-run', 'whole-course-preview'],
      resources: {
        remoteProjectAssets: 'remote-only-project-assets-not-supported-by-current-producer',
        localProjectAssets: 'required-saved-bytes-inline-data-url-in-authoring-and-preview',
        componentAssets: 'inline-data-url',
      },
      networkPolicy: {
        declaredConnectOrigins: ['https', 'wss'],
        enforcement: 'editor-scheme-csp-plus-main-session-exact-origin-leases',
        leaseLifetime: 'published-session-and-document-generation',
        corsTls: 'browser-enforced',
        remoteScripts: 'blocked',
      },
    })
    expect(index.headlessBuild).toEqual({
      language: 'typescript',
      runner: 'npx tsx --tsconfig <editor-root>/tsconfig.json <case-dir>/implementation/build.ts',
      entrypoints: {
        createCourseProject: 'src/renderer/project/createCourseProject.ts',
        courseProjectArchive: 'src/renderer/project/courseProjectArchive.ts',
        importComponentPackage: 'src/renderer/components/importComponentPackage.ts',
        courseProjectSchema: 'src/shared/courseProjectSchema.ts',
      },
      output: 'Course Project V9 .h5lesson',
      constraints: [
        'use-real-repository-apis',
        'no-shadow-project-dsl',
        'preserve-stable-ids-after-human-edits',
      ],
    })

    const catalog = parseFile<{
      status: string
      packageCount: number
      packages: unknown[]
      source: { trusted: boolean }
      issues: Array<{ code: string }>
    }>(first.files, 'component-catalog.snapshot.json')
    expect(first.componentCatalogStatus).toBe('unavailable')
    expect(catalog).toMatchObject({
      status: 'unavailable',
      packageCount: 0,
      packages: [],
      source: { trusted: false },
    })
    expect(catalog.issues[0]?.code).toBe('catalog-unavailable')
  }, 30_000)

  it.skipIf(!siblingCatalogAvailable)('verifies the reviewed sibling catalog packages, manifests, and blockers', async () => {
    const generated = await generateAiCapabilityArtifacts()
    const catalogRoot = path.resolve(process.cwd(), '..', 'courseware-components')
    const sourceCatalog = JSON.parse(
      await fs.readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'),
    ) as {
      packages: Array<{
        packageId: string
        version: string
        sha256: string
        quality: string
        maintainer: string
        supportedScopes: string[]
        source?: { kind: string; reference: string }
        license?: { status: string; expression?: string; reference?: string }
        releaseBlockers?: string[]
      }>
    }
    const catalog = parseFile<{
      status: string
      packageCount: number
      source: {
        expectedCatalogSha256: string
        actualCatalogSha256: string
        trusted: boolean
      }
      packages: Array<{
        packageId: string
        availability: string
        hashVerified: boolean
        manifestVerified: boolean
        quality: string
        maintainer: string
        license?: { status: string }
        source?: { kind: string; reference: string }
        releaseBlockers?: string[]
        supportedScopes: string[]
        version: string
        sha256: string
        actualSha256: string
      }>
    }>(generated.files, 'component-catalog.snapshot.json')

    expect(generated.componentCatalogStatus).toBe('available')
    expect(catalog).toMatchObject({
      status: 'available',
      packageCount: expectedCatalogPackageCount,
      source: {
        expectedCatalogSha256: BUILT_IN_COMPONENT_CATALOG_SHA256,
        actualCatalogSha256: BUILT_IN_COMPONENT_CATALOG_SHA256,
        trusted: true,
      },
    })
    expect(catalog.packages).toHaveLength(expectedCatalogPackageCount)
    for (const entry of catalog.packages) {
      const source = sourceCatalog.packages.find(
        (candidate) => candidate.packageId === entry.packageId &&
          candidate.version === entry.version,
      )
      expect(source).toBeDefined()
      expect(entry).toMatchObject({
        availability: 'available',
        hashVerified: true,
        manifestVerified: true,
        quality: 'experimental',
        license: { status: 'unknown' },
      })
      expect(entry.actualSha256).toBe(entry.sha256)
      expect(entry.maintainer).not.toBe('')
      expect(entry.source?.reference).toBeTruthy()
      expect(entry.releaseBlockers?.length).toBeGreaterThan(0)
      expect(entry.supportedScopes.length).toBeGreaterThan(0)
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/)
      expect({
        version: entry.version,
        sha256: entry.sha256,
        quality: entry.quality,
        maintainer: entry.maintainer,
        supportedScopes: entry.supportedScopes,
        source: entry.source,
        license: entry.license,
        releaseBlockers: entry.releaseBlockers,
      }).toEqual({
        version: source!.version,
        sha256: source!.sha256,
        quality: source!.quality,
        maintainer: source!.maintainer,
        supportedScopes: source!.supportedScopes,
        source: source!.source,
        license: source!.license,
        releaseBlockers: source!.releaseBlockers,
      })
    }
  }, 30_000)

  it.skipIf(!siblingCatalogAvailable)('marks a catalog hash mismatch unavailable without hiding package metadata', async () => {
    const sourceRoot = path.resolve(process.cwd(), '..', 'courseware-components')
    const fixtureRoot = await createTemporaryDirectory('ai-capability-catalog-mismatch')
    try {
      const catalogBytes = await fs.readFile(path.join(sourceRoot, 'catalog.json'))
      const raw = JSON.parse(catalogBytes.toString('utf8')) as {
        catalogVersion: number
        name?: string
        packages: Array<Record<string, unknown>>
      }
      raw.name = `${raw.name ?? 'catalog'} mismatch fixture`
      await fs.writeFile(
        path.join(fixtureRoot, 'catalog.json'),
        `${JSON.stringify(raw)}\n`,
        'utf8',
      )

      const generated = await generateAiCapabilityArtifacts({
        componentCatalogRoot: fixtureRoot,
        componentCatalogLabel: 'test-fixture/catalog-hash-mismatch',
      })
      const catalog = parseFile<{
        status: string
        packageCount: number
        packages: Array<{
          availability: string
          quality: string
          maintainer: string
          license?: { status: string }
          source?: { reference: string }
          releaseBlockers?: string[]
          sha256: string
        }>
        source: { trusted: boolean }
        issues: Array<{ code: string }>
      }>(generated.files, 'component-catalog.snapshot.json')

      expect(generated.componentCatalogStatus).toBe('unavailable')
      expect(catalog).toMatchObject({
        status: 'unavailable',
        packageCount: expectedCatalogPackageCount,
        source: { trusted: false },
      })
      expect(catalog.issues.some((issue) => issue.code === 'catalog-hash-mismatch')).toBe(true)
      for (const entry of catalog.packages) {
        expect(entry).toMatchObject({
          availability: 'unavailable',
          quality: 'experimental',
          license: { status: 'unknown' },
        })
        expect(entry.maintainer).not.toBe('')
        expect(entry.source?.reference).toBeTruthy()
        expect(entry.releaseBlockers?.length).toBeGreaterThan(0)
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      }
    } finally {
      await removeTemporaryDirectory(fixtureRoot)
    }
  }, 30_000)

  it.skipIf(!siblingCatalogAvailable)('marks package bytes with a mismatched catalog hash unavailable', async () => {
    const sourceRoot = path.resolve(process.cwd(), '..', 'courseware-components')
    const fixtureRoot = await createTemporaryDirectory('ai-capability-package-mismatch')
    try {
      const catalogBytes = await fs.readFile(path.join(sourceRoot, 'catalog.json'))
      const raw = JSON.parse(catalogBytes.toString('utf8')) as {
        packages: Array<{
          packageId: string
          version: string
          packagePath: string
        }>
      }
      const target = raw.packages[0]!
      const targetDirectory = path.dirname(
        path.join(fixtureRoot, ...target.packagePath.split('/')),
      )
      await fs.mkdir(targetDirectory, { recursive: true })
      await fs.writeFile(path.join(fixtureRoot, 'catalog.json'), catalogBytes)
      const originalPackage = await fs.readFile(
        path.join(sourceRoot, ...target.packagePath.split('/')),
      )
      await fs.writeFile(
        path.join(fixtureRoot, ...target.packagePath.split('/')),
        Buffer.concat([originalPackage, Buffer.from([0])]),
      )

      const generated = await generateAiCapabilityArtifacts({
        componentCatalogRoot: fixtureRoot,
        componentCatalogLabel: 'test-fixture/package-hash-mismatch',
      })
      const catalog = parseFile<{
        status: string
        source: { trusted: boolean }
        packages: Array<{
          packageId: string
          availability: string
          hashVerified: boolean
          manifestVerified: boolean
          unavailableReasons: string[]
        }>
        issues: Array<{ packageId?: string; code: string }>
      }>(generated.files, 'component-catalog.snapshot.json')
      const snapshotTarget = catalog.packages.find(
        (entry) => entry.packageId === target.packageId,
      )
      expect(generated.componentCatalogStatus).toBe('degraded')
      expect(catalog.source.trusted).toBe(true)
      expect(snapshotTarget).toMatchObject({
        availability: 'unavailable',
        hashVerified: false,
        manifestVerified: false,
        unavailableReasons: ['package-hash-mismatch'],
      })
      expect(catalog.issues).toContainEqual({
        packageId: target.packageId,
        code: 'package-hash-mismatch',
        message: expect.any(String),
      })
    } finally {
      await removeTemporaryDirectory(fixtureRoot)
    }
  }, 30_000)

  it('distinguishes stale capability bytes from stale provenance evidence', async () => {
    const outputRoot = await createTemporaryDirectory('ai-capability-output')
    try {
      const generated = await generateAiCapabilityArtifacts({
        componentCatalogRoot: path.resolve(
          process.cwd(),
          'tests',
          '__missing-ai-capability-catalog__',
        ),
        componentCatalogLabel: 'test-fixture/missing-catalog',
      })
      await writeAiCapabilityArtifacts(outputRoot, generated)
      await expect(checkAiCapabilityArtifacts(outputRoot, generated)).resolves.toBeUndefined()
      await fs.appendFile(path.join(outputRoot, 'index.json'), 'stale', 'utf8')
      await expect(checkAiCapabilityArtifacts(outputRoot, generated)).rejects.toThrow(
        /能力生成物过期 index\.json/,
      )

      await writeAiCapabilityArtifacts(outputRoot, generated)
      await fs.appendFile(
        path.join(outputRoot, 'generation-evidence.json'),
        'stale',
        'utf8',
      )
      await expect(checkAiCapabilityArtifacts(outputRoot, generated)).rejects.toThrow(
        /来源溯源证据过期 generation-evidence\.json/,
      )

      await fs.appendFile(path.join(outputRoot, 'index.json'), 'stale', 'utf8')
      const combinedFailure = await checkAiCapabilityArtifacts(outputRoot, generated)
        .then(() => undefined)
        .catch((error: unknown) => error)
      expect(combinedFailure).toBeInstanceOf(Error)
      expect((combinedFailure as Error).message).toContain(
        '能力生成物过期 index.json',
      )
      expect((combinedFailure as Error).message).not.toContain('来源溯源证据过期')
    } finally {
      await removeTemporaryDirectory(outputRoot)
    }
  }, 30_000)

  it('reports missing and extra files without mutating the output directory', async () => {
    const outputRoot = await createTemporaryDirectory('ai-capability-check-readonly')
    try {
      const generated = await generateAiCapabilityArtifacts({
        componentCatalogRoot: path.resolve(
          process.cwd(),
          'tests',
          '__missing-ai-capability-catalog__',
        ),
        componentCatalogLabel: 'test-fixture/missing-catalog',
      })
      await writeAiCapabilityArtifacts(outputRoot, generated)
      const missingPath = path.join(outputRoot, 'limits.json')
      const extraPath = path.join(outputRoot, 'extra.json')
      await fs.rm(missingPath)
      await fs.writeFile(extraPath, '{"extra":true}\n', 'utf8')

      const trackedPaths = [...generated.files.keys()]
        .filter((relativePath) => relativePath !== 'limits.json')
      const fixedTime = new Date('2000-01-01T00:00:00.000Z')
      await Promise.all(trackedPaths.map((relativePath) =>
        fs.utimes(
          path.join(outputRoot, ...relativePath.split('/')),
          fixedTime,
          fixedTime,
        ),
      ))
      const before = await fs.readdir(outputRoot, { recursive: true })
      const beforeFiles = await Promise.all(trackedPaths.map(async (relativePath) => {
        const absolute = path.join(outputRoot, ...relativePath.split('/'))
        return {
          relativePath,
          content: await fs.readFile(absolute, 'utf8'),
          mtimeMs: (await fs.stat(absolute)).mtimeMs,
        }
      }))
      await expect(checkAiCapabilityArtifacts(outputRoot, generated)).rejects.toThrow(
        /缺失 limits\.json[\s\S]*多余 extra\.json/,
      )
      const after = await fs.readdir(outputRoot, { recursive: true })
      expect(after).toEqual(before)
      const afterFiles = await Promise.all(trackedPaths.map(async (relativePath) => {
        const absolute = path.join(outputRoot, ...relativePath.split('/'))
        return {
          relativePath,
          content: await fs.readFile(absolute, 'utf8'),
          mtimeMs: (await fs.stat(absolute)).mtimeMs,
        }
      }))
      expect(afterFiles).toEqual(beforeFiles)
      await expect(fs.readFile(extraPath, 'utf8')).resolves.toBe('{"extra":true}\n')
      await expect(fs.stat(missingPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await removeTemporaryDirectory(outputRoot)
    }
  }, 30_000)

  it.skipIf(!siblingCatalogAvailable)('keeps every verified manifest version and hash tied to package bytes', async () => {
    const catalogRoot = path.resolve(process.cwd(), '..', 'courseware-components')
    const catalog = JSON.parse(
      await fs.readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'),
    ) as {
      packages: Array<{
        packageId: string
        version: string
        packagePath: string
        sha256: string
        releaseBlockers?: string[]
      }>
    }
    expect(catalog.packages).toHaveLength(expectedCatalogPackageCount)
    for (const entry of catalog.packages) {
      const bytes = Uint8Array.from(
        await fs.readFile(path.join(catalogRoot, ...entry.packagePath.split('/'))),
      )
      expect(sha256(bytes)).toBe(entry.sha256)
      const archive = unzipSync(bytes)
      const manifestBytes = archive['manifest.json']
      expect(manifestBytes).toBeDefined()
      const manifest = componentManifestSchema.parse(
        JSON.parse(new TextDecoder().decode(manifestBytes)) as unknown,
      )
      expect(manifest).toMatchObject({
        id: entry.packageId,
        version: entry.version,
        schemaVersion: COMPONENT_SCHEMA_VERSION,
        runtimeApiVersion: COMPONENT_RUNTIME_API_VERSION,
      })
      expect(entry.releaseBlockers?.length).toBeGreaterThan(0)
    }
  }, 30_000)

  it('binds the generated schemas to the current protocol constants', async () => {
    const generated = await generateAiCapabilityArtifacts({
      componentCatalogRoot: path.resolve(
        process.cwd(),
        'tests',
        '__missing-ai-capability-catalog__',
      ),
      componentCatalogLabel: 'test-fixture/missing-catalog',
    })
    const index = parseFile<{
      protocols: {
        project: number
        publishedCourse: number
        runtime: number[]
        component: number
        interaction: number
      }
    }>(generated.files, 'index.json')
    expect(index.protocols).toEqual(expectedCurrentProtocols)
    expect(generated.files.has('schemas/project-v8.json')).toBe(false)

    const project = parseFile<{
      contract: string
      artifactKind: string
      isValidationSchema: boolean
      protocolVersion: number
      validationAuthority: {
        kind: string
        module: string
        export: string
        relationship: string
      }
      nativeTypes: string[]
    }>(generated.files, 'schemas/course-project-v9.json')
    expect(project.contract).toBe('Course Project V9')
    expect(project.artifactKind).toBe('builder-capability-summary')
    expect(project.isValidationSchema).toBe(false)
    expect(project).not.toHaveProperty('sourceOfTruth')
    expect(project).not.toHaveProperty('root')
    expect(project.protocolVersion).toBe(COURSE_PROJECT_SCHEMA_VERSION)
    expect(project.validationAuthority).toEqual({
      kind: 'executable-zod-schema',
      module: 'src/shared/courseProjectSchema.ts',
      export: 'courseProjectDocumentSchema',
      relationship: 'referenced-not-derived',
    })
    expect(project.nativeTypes).toEqual([...COURSE_NATIVE_TYPES])
    expect(project.nativeTypes).not.toContain('external-component')
    const published = parseFile<{
      artifactKind: string
      isValidationSchema: boolean
      formatVersion: number
      validationAuthority: {
        kind: string
        module: string
        export: string
        relationship: string
      }
    }>(generated.files, 'schemas/published-course-v2.json')
    expect(published.artifactKind).toBe('builder-capability-summary')
    expect(published.isValidationSchema).toBe(false)
    expect(published).not.toHaveProperty('sourceOfTruth')
    expect(published.formatVersion).toBe(PUBLISHED_COURSE_VERSION)
    expect(published.validationAuthority).toEqual({
      kind: 'executable-zod-schema',
      module: 'src/shared/publishedCourseSchema.ts',
      export: 'publishedCourseV2Schema',
      relationship: 'referenced-not-derived',
    })
    const canvasRuntime = parseFile<{
      runtimeApiVersion: number
      publishedPlayback: {
        status: string
        supportedSlices: Array<{
          surface?: string
          surfaces?: string[]
          carrier: string
          scope: string
          renderModes: string[]
          consumers: string[]
          lifetime?: string
        }>
        notCovered: string[]
        sharedServices: Record<string, string>
        staticExport: Record<string, string>
      }
    }>(generated.files, 'schemas/runtime-api2.json')
    expect(canvasRuntime.publishedPlayback).toMatchObject({
      status: 'partial',
      supportedSlices: [
        {
          surface: 'slide',
          carrier: 'scene.layerItems',
          scope: 'scene-local',
          renderModes: ['dom', 'phaser', 'hybrid'],
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
        },
        {
          surfaces: ['slide', 'flow', 'spatial-2d'],
          carrier: 'globalLayerItems',
          scope: 'session-global',
          renderModes: ['dom', 'phaser', 'hybrid'],
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
          lifetime: 'one-instance-per-published-session-moved-between-surface-wrappers',
        },
      ],
    })
    expect(canvasRuntime.publishedPlayback.notCovered).toEqual(expect.arrayContaining([
      'surfaceLayerItems',
      'flow-or-spatial-scene-local',
      'declarative-runtime.event-trigger',
      'dynamic-runtime-navigation.guard',
      'global-local-runtime-shared-event-bus',
      'published-assessment-evidence-persistence',
      'node-resolution',
      'presentation-outside-slide-scene',
      'mixed-pdf-slide-dynamic-capture',
      'flow-or-spatial-dynamic-capture-pdf-or-pptx',
      'no-stable-host-local-interface-and-cross-export-network-parity',
    ]))
    expect(canvasRuntime.publishedPlayback.sharedServices).toEqual({
      courseState: 'declared-defaults-shared-across-active-published-carriers',
      hostActions: 'go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
    })
    expect(canvasRuntime.publishedPlayback.staticExport).toEqual({
      slideScene: 'enabled-api2-pptx-real-item-capture-and-pure-slide-pdf-page-capture',
      global: 'enabled-api2-real-capture-in-pure-slide-static-exports-only',
      flowAndSpatialDynamicCarriers: 'not-covered',
    })
    const surfaceRuntime = parseFile<{
      runtimeApiVersion: number
      protocol: string
      publishedPlayback: {
        status: string
        supportedSlice: { consumers: string[] }
        supportedSlices: Array<{
          surface: string
          carrier: string
          scope: string
          consumers: string[]
        }>
        notCovered: string[]
        sharedServices: Record<string, string>
        staticExport: Record<string, string>
      }
    }>(generated.files, 'schemas/runtime-api3.json')
    expect(surfaceRuntime).toMatchObject({
      protocol: 'surface-runtime',
      runtimeApiVersion: SURFACE_RUNTIME_API_VERSION,
      publishedPlayback: {
        status: 'partial',
        supportedSlice: {
          consumers: [
            'current-location-try-run',
            'whole-course-preview',
            'single-html',
            'web-package',
          ],
        },
      },
    })
    expect(surfaceRuntime.publishedPlayback.notCovered).toEqual(expect.arrayContaining([
      'spatial',
      'globalLayerItems-or-non-flow-surfaceLayerItems',
      'declarative-runtime.event-trigger',
      'presentation-outside-slide-scene',
      'mixed-pdf-slide-dynamic-capture',
      'flow-or-spatial-dynamic-capture-pdf-or-pptx',
      'stable-host-local-interfaces-and-cross-export-network-parity',
    ]))
    expect(surfaceRuntime.publishedPlayback.supportedSlices).toEqual([
      expect.objectContaining({
        surface: 'slide',
        carrier: 'scene.layerItems',
        scope: 'scene-local',
      }),
      expect.objectContaining({
        surface: 'flow',
        carrier: 'surfaceLayerItems',
        scope: 'surface-local',
      }),
    ])
    expect(surfaceRuntime.publishedPlayback.sharedServices).toEqual({
      courseState: 'declared-defaults-shared-across-active-published-carriers',
      hostActions: 'go-next-previous-cross-location-guarded; replay-same-location; restart-bypasses-guards-and-resets-defaults',
    })
    expect(surfaceRuntime.publishedPlayback.staticExport).toEqual({
      slideScene: 'enabled-api3-pptx-real-item-capture-and-pure-slide-pdf-page-capture',
      flowAndSpatialDynamicCarriers: 'not-covered',
    })
    const interactions = parseFile<{
      contract: string
      protocolVersion: number
    }>(generated.files, 'schemas/interactions.json')
    expect(interactions).toMatchObject({
      contract: 'Interaction Protocol V1',
      protocolVersion: INTERACTION_PROTOCOL_VERSION,
    })
    const runtime = parseFile<{
      documentSchema: { properties: { runtimeApiVersion: { const: number } } }
      hostContract: {
        assessment: {
          hostEvidence: {
            schemaVersion: number
            recordKinds: string[]
            sessionStartBeforeRuntimeMount: boolean
          }
        }
        evidence: {
          invocation: string
          actionKinds: string[]
          requiresTrustedDispatchedEvent: boolean
        }
      }
    }>(generated.files, 'schemas/runtime-api2.json')
    expect(runtime.documentSchema.properties.runtimeApiVersion.const).toBe(
      RUNTIME_API_VERSION,
    )
    expect(runtime.hostContract.assessment.hostEvidence).toMatchObject({
      schemaVersion: 1,
      recordKinds: [
        'assessment-evaluated',
        'action-recorded',
      ],
      sessionStartBeforeRuntimeMount: true,
    })
    expect(runtime.hostContract.evidence).toMatchObject({
      invocation: 'ctx.evidence.recordAction',
      actionKinds: [
        'click', 'select', 'text-input', 'formula-input', 'drag', 'sort',
        'circle-text', 'highlight', 'parameter-change', 'oral', 'paper',
        'teacher-command',
      ],
      requiresTrustedDispatchedEvent: true,
    })
    const component = parseFile<{
      manifestSchema: {
        properties: {
          schemaVersion: { const: number }
          runtimeApiVersion: { const: number }
        }
      }
      publishedPlayback: {
        supportedSlices: Array<Record<string, unknown>>
        staticExport: Record<string, string>
        notCovered: string[]
      }
    }>(generated.files, 'schemas/component-api4.json')
    expect(component.manifestSchema.properties.schemaVersion.const).toBe(
      COMPONENT_SCHEMA_VERSION,
    )
    expect(component.manifestSchema.properties.runtimeApiVersion.const).toBe(
      COMPONENT_RUNTIME_API_VERSION,
    )
    expect(component.publishedPlayback.supportedSlices).toEqual(
      parseFile<{
        components: {
          publishedPlayback: { provenSlices: Array<Record<string, unknown>> }
        }
      }>(generated.files, 'index.json').components.publishedPlayback.provenSlices,
    )
    expect(component.publishedPlayback.notCovered).toContain(
      'global-component-session-lifetime-and-scope-parity',
    )
    expect(component.publishedPlayback.staticExport).toEqual({
      pdf: 'pure-slide-page-capture-runs-dom-scene-surface-global-and-phaser-scene; mixed-flow-spatial-use-static-fallback-or-label',
      pptx: 'slide-dom-scene-surface-and-phaser-scene-real-item-capture; global-dom-only-in-pure-slide; failure-uses-authored-fallback-or-visible-placeholder',
    })
  }, 15_000)

  it('records source traceability without an index/evidence self-hash cycle', async () => {
    const generated = await generateAiCapabilityArtifacts({
      componentCatalogRoot: path.resolve(
        process.cwd(),
        'tests',
        '__missing-ai-capability-catalog__',
      ),
      componentCatalogLabel: 'test-fixture/missing-catalog',
    })
    const index = parseFile<{
      artifacts: Record<string, { sha256: string }>
      hashScope: string
    }>(generated.files, 'index.json')
    expect(Object.keys(index.artifacts)).toEqual([
      'component-catalog.snapshot.json',
      'diagnostics.json',
      'limits.json',
      'schemas/component-api4.json',
      'schemas/course-project-v9.json',
      'schemas/interactions.json',
      'schemas/published-course-v2.json',
      'schemas/runtime-api2.json',
      'schemas/runtime-api3.json',
    ])
    expect(index.artifacts).not.toHaveProperty('index.json')
    expect(index.artifacts).not.toHaveProperty('generation-evidence.json')
    expect(index.hashScope).toContain('不自哈希')

    const evidence = parseFile<{
      generator: string
      generatedAt: null
      inputs: {
        sourceDiscovery: {
          kind: string
          entrypoints: string[]
          aliases: Record<string, string>
          includesTypeOnlyEdges: boolean
        }
        sourceFiles: Array<{ path: string; sha256: string }>
        componentCatalog: {
          status: string
          expectedCatalogSha256: string
          actualCatalogSha256?: string
          packages: Array<{
            identity: string
            expectedSha256: string
            actualSha256?: string
            availability: string
          }>
        }
      }
      output: Record<string, { bytes: number; sha256: string }>
      hashScope: string
    }>(generated.files, 'generation-evidence.json')
    expect(evidence.generator).toBe('scripts/generate-ai-capabilities.ts')
    expect(evidence.generatedAt).toBeNull()
    expect(evidence.output).toHaveProperty('index.json')
    expect(evidence.output).not.toHaveProperty('generation-evidence.json')
    expect(evidence.hashScope).toContain('不记录 generation-evidence.json 自身哈希')
    expect(evidence.inputs.sourceDiscovery).toEqual({
      kind: 'transitive-local-module-closure',
      entrypoints: expectedProvenanceEntrypoints,
      aliases: { '@/': 'src/' },
      includesTypeOnlyEdges: true,
    })
    const tracedSources = evidence.inputs.sourceFiles.map((entry) => entry.path)
    expect(tracedSources).toEqual(
      [...new Set(tracedSources)].sort((left, right) =>
        left.localeCompare(right, 'en'),
      ),
    )
    for (const entry of evidence.inputs.sourceFiles) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
    }

    for (const entrypoint of expectedProvenanceEntrypoints) {
      expect(tracedSources, `${entrypoint} must be source evidence`)
        .toContain(entrypoint)
    }
    // These are transitive dependencies that the former hand-maintained list
    // repeatedly missed. The closure must follow barrels and nested schemas.
    expect(tracedSources).toContain('src/shared/contracts/course-project-v9/schema.ts')
    expect(tracedSources).toContain('src/shared/contracts/published-course-v2/schema.ts')
    expect(tracedSources).toContain('src/shared/projectSchema.ts')
    expect(tracedSources).toContain('src/shared/projectTypes.ts')
    expect(tracedSources).toContain('src/renderer/project/archivePath.ts')

    // Broad producer implementations carry described behaviour, not generation
    // input bytes; listing them churned the evidence on unrelated edits.
    for (const excluded of [
      'package-lock.json',
      'src/main/createWindow.ts',
      'src/main/previewNetworkPolicy.ts',
      'src/preload/index.ts',
      'src/player/PlayerApp.ts',
      'src/player/RuntimeHost.ts',
      'src/player/CourseRuntimeKernel.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/runtime/publishedCanvasRuntimeMount.ts',
      'src/player/surfaces/slide/SlidePublishedAdapter.ts',
      'src/renderer/components/componentPackageStore.ts',
      'src/renderer/export/course/buildCoursePackages.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
      'src/renderer/export/course/buildPublishedCourse.ts',
      'src/renderer/project/createCourseProject.ts',
      'src/renderer/project/courseProjectArchive.ts',
      'src/renderer/ui/coursePlayerTryRun.ts',
      'src/renderer/project/createProject.ts',
      'src/renderer/project/projectArchive.ts',
      'src/renderer/project/validateProjectArchive.ts',
    ]) {
      expect(tracedSources, `${excluded} must not be source evidence`)
        .not.toContain(excluded)
    }
    expect(tracedSources.filter((entry) => entry.startsWith('src/main/'))).toEqual([])
    expect(tracedSources.filter((entry) => entry.startsWith('src/preload/'))).toEqual([])
    expect(tracedSources.filter((entry) => entry.startsWith('src/renderer/export/course/')))
      .toEqual([])
    expect(tracedSources).toContain('src/player/HostEvidenceRecorder.ts')

    // Narrowing provenance inputs must not weaken catalog or output hashes.
    expect(evidence.inputs.componentCatalog).toEqual({
      status: 'unavailable',
      expectedCatalogSha256: BUILT_IN_COMPONENT_CATALOG_SHA256,
      packages: [],
    })
    expect(Object.keys(evidence.output)).toEqual([
      'component-catalog.snapshot.json',
      'diagnostics.json',
      'index.json',
      'limits.json',
      'schemas/component-api4.json',
      'schemas/course-project-v9.json',
      'schemas/interactions.json',
      'schemas/published-course-v2.json',
      'schemas/runtime-api2.json',
      'schemas/runtime-api3.json',
    ])
    for (const [relativePath, entry] of Object.entries(evidence.output)) {
      expect(entry.sha256).toBe(
        createHash('sha256').update(generated.files.get(relativePath)!).digest('hex'),
      )
      expect(entry.bytes).toBe(
        Buffer.byteLength(generated.files.get(relativePath)!, 'utf8'),
      )
    }

    const project = parseFile<{
      validationAuthority: { module: string; relationship: string }
      capabilitySources: string[]
    }>(
      generated.files,
      'schemas/course-project-v9.json',
    )
    const published = parseFile<{
      validationAuthority: { module: string; relationship: string }
      capabilitySources: string[]
    }>(
      generated.files,
      'schemas/published-course-v2.json',
    )
    const interactions = parseFile<{ sourceOfTruth: string[] }>(
      generated.files,
      'schemas/interactions.json',
    )
    const runtime = parseFile<{ sourceOfTruth: string[] }>(
      generated.files,
      'schemas/runtime-api2.json',
    )
    const component = parseFile<{ sourceOfTruth: string[] }>(
      generated.files,
      'schemas/component-api4.json',
    )
    const diagnostics = parseFile<{ legacyV8: { sourceOfTruth: string } }>(
      generated.files,
      'diagnostics.json',
    )
    const limits = parseFile<{ sourceOfTruth: string[] }>(
      generated.files,
      'limits.json',
    )
    expect(project.validationAuthority).toMatchObject({
      module: 'src/shared/courseProjectSchema.ts',
      relationship: 'referenced-not-derived',
    })
    expect(project.capabilitySources).toContain('src/shared/courseProjectTypes.ts')
    expect(published.validationAuthority).toMatchObject({
      module: 'src/shared/publishedCourseSchema.ts',
      relationship: 'referenced-not-derived',
    })
    expect(published.capabilitySources).toContain('src/shared/publishedCourseTypes.ts')
    expect(interactions.sourceOfTruth).toEqual([
      'src/shared/interactionTypes.ts',
      'src/shared/interactionSchema.ts',
      'src/shared/publishedInteractionSupport.ts',
      'src/player/interactions/PublishedInteractionController.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
    ])
    expect(runtime.sourceOfTruth).toContain('src/shared/runtimeSchema.ts')
    expect(component.sourceOfTruth).toContain('src/shared/componentSchema.ts')
    expect(component.sourceOfTruth).toEqual(expect.arrayContaining([
      'src/player/surfaces/flow/FlowSurfaceHost.ts',
      'src/player/surfaces/spatial/SpatialSurfaceHost.ts',
      'src/player/surfaces/publishedDynamicHosts.ts',
      'src/player/surfaces/publishedCourseState.ts',
      'src/player/surfaces/publishedCapture.ts',
      'src/renderer/export/course/publishedSlideCapture.ts',
      'src/renderer/export/course/buildCoursePptx.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
    ]))
    expect(diagnostics.legacyV8.sourceOfTruth).toBe('src/shared/diagnosticCodes.ts')
    expect(limits.sourceOfTruth).toContain('src/shared/constants.ts')
  }, 15_000)

  it.skipIf(!siblingCatalogAvailable)('keeps every committed capability artifact byte-identical outside generation-evidence.json', async () => {
    const generated = await generateAiCapabilityArtifacts()
    const committedRoot = path.join(process.cwd(), 'artifacts', 'ai-capabilities')
    const drifted: string[] = []
    for (const [relativePath, content] of generated.files) {
      if (relativePath === 'generation-evidence.json') continue
      const committed = await fs.readFile(
        path.join(committedRoot, ...relativePath.split('/')),
        'utf8',
      )
      if (committed !== content) drifted.push(relativePath)
    }
    expect(drifted).toEqual([])
    // Provenance scope lives only in generation-evidence.json: no other artifact
    // records source files, so narrowing the input set cannot move capability bytes.
    for (const [relativePath, content] of generated.files) {
      if (relativePath === 'generation-evidence.json') continue
      expect(content, `${relativePath} must not embed source provenance`)
        .not.toContain('sourceFiles')
    }
  }, 30_000)

  it('rejects an oversized canonical index fixture', () => {
    expect(() => assertIndexWithinLimit({
      oversized: 'x'.repeat(AI_CAPABILITY_INDEX_MAX_BYTES),
    })).toThrow(/16384/)
  })
})
