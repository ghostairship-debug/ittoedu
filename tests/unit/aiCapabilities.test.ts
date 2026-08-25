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
  INTERACTION_ACTION_TYPES,
  INTERACTION_CONDITION_TYPES,
  INTERACTION_TRIGGER_TYPES,
} from '../../src/shared/interactionTypes'
import { PUBLISHED_COURSE_VERSION } from '../../src/shared/publishedCourseTypes'
import { SURFACE_RUNTIME_API_VERSION } from '../../src/shared/surfaceRuntimeTypes'

const expectedCatalogPackageCount = 4
const siblingCatalogAvailable = existsSync(
  path.join(process.cwd(), '..', 'courseware-components', 'catalog.json'),
)
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
      nodes: Array<{ type: string }>
      interactions: {
        triggerTypes: string[]
        conditionTypes: string[]
        actionTypes: string[]
      }
      validation: {
        command: string
        output: string
        reportVersion: number
        checks: string[]
        exitCodes: Record<string, number>
        execution: string
      }
      components: {
        packageAdmission: Record<string, unknown>
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
    }>(first.files, 'index.json')
    expect(first.indexBytes).toBeLessThanOrEqual(AI_CAPABILITY_INDEX_MAX_BYTES)
    expect(first.indexBytes).toBe(canonicalJsonByteLength(index))
    expect(index.nodes.map((entry) => entry.type)).toEqual([
      ...COURSE_NATIVE_TYPES,
    ])
    expect(index.nodes.map((entry) => entry.type)).not.toContain('external-component')
    expect(index.interactions.triggerTypes).toEqual(INTERACTION_TRIGGER_TYPES)
    expect(index.interactions.conditionTypes).toEqual(INTERACTION_CONDITION_TYPES)
    expect(index.interactions.actionTypes).toEqual(INTERACTION_ACTION_TYPES)
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
      ],
      exitCodes: {
        valid: 0,
        diagnosedErrors: 1,
        unreadableOrUsageError: 2,
      },
      execution: 'node-only-no-electron-no-export-no-write',
    })
    expect(index.components.packageAdmission).toEqual({
      requiredAvailability: 'available',
      allowedQualitiesForRelease: ['stable'],
      experimentalRequiresExplicitCaseApproval: true,
      releaseBlockersMustBeEmpty: true,
      licenseStatusMustBe: 'verified',
      maintainerMustBeAssigned: true,
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
      protocolVersion: number
      root: { properties: { schemaVersion: { const: number } } }
      nativeTypes: string[]
    }>(generated.files, 'schemas/course-project-v9.json')
    expect(project.contract).toBe('Course Project V9')
    expect(project.protocolVersion).toBe(COURSE_PROJECT_SCHEMA_VERSION)
    expect(project.root.properties.schemaVersion.const).toBe(COURSE_PROJECT_SCHEMA_VERSION)
    expect(project.nativeTypes).toEqual([...COURSE_NATIVE_TYPES])
    expect(project.nativeTypes).not.toContain('external-component')
    const published = parseFile<{
      formatVersion: number
    }>(generated.files, 'schemas/published-course-v2.json')
    expect(published.formatVersion).toBe(PUBLISHED_COURSE_VERSION)
    const surfaceRuntime = parseFile<{
      runtimeApiVersion: number
      protocol: string
      publishedPlayback: {
        status: string
        supportedSlice: { consumers: string[] }
        notCovered: string[]
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
      'canvas-runtime-api2',
      'flow-or-spatial',
      'globalLayerItems-or-surfaceLayerItems',
      'runtime.event-or-host-actions',
      'cross-surface-courseState-or-presentation',
      'capture-pdf-or-pptx',
      'network-or-host-local-capabilities',
    ]))
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
            teacherEscape: {
              actions: string[]
              phases: string[]
              eventType: string
              requiresTrustedDispatchedClick: boolean
              runtimeExposure: string
              publicCustomEventIsEvidence: boolean
            }
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
        'teacher-escape-recorded',
      ],
      sessionStartBeforeRuntimeMount: true,
      teacherEscape: {
        actions: ['previous', 'next', 'scene-picker', 'replay'],
        phases: ['requested', 'confirmation-required', 'completed'],
        eventType: 'click',
        requiresTrustedDispatchedClick: true,
        runtimeExposure: 'none',
        publicCustomEventIsEvidence: false,
      },
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
    }>(generated.files, 'schemas/component-api4.json')
    expect(component.manifestSchema.properties.schemaVersion.const).toBe(
      COMPONENT_SCHEMA_VERSION,
    )
    expect(component.manifestSchema.properties.runtimeApiVersion.const).toBe(
      COMPONENT_RUNTIME_API_VERSION,
    )
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
      inputs: { sourceFiles: Array<{ path: string; sha256: string }> }
      output: Record<string, { sha256: string }>
      hashScope: string
    }>(generated.files, 'generation-evidence.json')
    expect(evidence.generator).toBe('scripts/generate-ai-capabilities.ts')
    expect(evidence.generatedAt).toBeNull()
    expect(evidence.output).toHaveProperty('index.json')
    expect(evidence.output).not.toHaveProperty('generation-evidence.json')
    expect(evidence.hashScope).toContain('不记录 generation-evidence.json 自身哈希')
    const tracedSources = evidence.inputs.sourceFiles.map((entry) => entry.path)
    expect(tracedSources).toEqual(expect.arrayContaining([
      'src/shared/courseProjectSchema.ts',
      'src/shared/courseProjectTypes.ts',
      'src/shared/publishedCourseSchema.ts',
      'src/shared/publishedCourseTypes.ts',
      'src/shared/surfaceRuntimeTypes.ts',
      'src/shared/interactionSchema.ts',
      'src/shared/interactionTypes.ts',
      'src/shared/runtimeSchema.ts',
      'src/shared/componentSchema.ts',
      'src/shared/diagnosticCodes.ts',
      'src/shared/constants.ts',
      'src/renderer/export/exportSize.ts',
      'src/renderer/export/course/buildCoursePackages.ts',
      'src/renderer/export/course/buildCoursePrintArtifacts.ts',
      'src/renderer/export/course/buildPublishedCourse.ts',
      'scripts/validate-project.ts',
      'src/renderer/components/componentPackageStore.ts',
      'src/renderer/project/createCourseProject.ts',
      'src/renderer/project/courseProjectArchive.ts',
      'src/shared/layoutMeasure.ts',
      'src/shared/componentContentIntegrity.ts',
      'src/shared/textLayout.ts',
      'src/shared/formulaRenderer.ts',
      'src/shared/stableOrder.ts',
    ]))
    expect(tracedSources).not.toContain('src/shared/projectSchema.ts')
    expect(tracedSources).not.toContain('src/renderer/project/createProject.ts')
    expect(tracedSources).not.toContain('src/renderer/project/projectArchive.ts')
    expect(tracedSources).not.toContain('src/renderer/project/validateProjectArchive.ts')

    const project = parseFile<{ sourceOfTruth: string }>(
      generated.files,
      'schemas/course-project-v9.json',
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
    const diagnostics = parseFile<{ sourceOfTruth: string }>(
      generated.files,
      'diagnostics.json',
    )
    const limits = parseFile<{ sourceOfTruth: string[] }>(
      generated.files,
      'limits.json',
    )
    expect(project.sourceOfTruth).toBe('src/shared/courseProjectSchema.ts')
    expect(interactions.sourceOfTruth).toEqual([
      'src/shared/interactionTypes.ts',
      'src/shared/interactionSchema.ts',
    ])
    expect(runtime.sourceOfTruth).toContain('src/shared/runtimeSchema.ts')
    expect(component.sourceOfTruth).toContain('src/shared/componentSchema.ts')
    expect(diagnostics.sourceOfTruth).toBe('src/shared/diagnosticCodes.ts')
    expect(limits.sourceOfTruth).toContain('src/shared/constants.ts')
  }, 15_000)

  it('rejects an oversized canonical index fixture', () => {
    expect(() => assertIndexWithinLimit({
      oversized: 'x'.repeat(AI_CAPABILITY_INDEX_MAX_BYTES),
    })).toThrow(/16384/)
  })
})
