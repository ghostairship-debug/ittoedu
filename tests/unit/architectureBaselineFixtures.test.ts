import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  ARCHITECTURE_BASELINE_FIXTURE_IDS,
  ARCHITECTURE_BASELINE_FIXTURE_MTIME,
  ARCHITECTURE_BASELINE_FIXTURE_SPECS,
  ARCHITECTURE_BASELINE_FIXTURE_ZIP_MTIME,
  ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY,
  buildArchitectureBaselineFixtureOutputs,
  type ArchitectureBaselineFixtureId,
} from '../../scripts/build-architecture-baseline-fixtures'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { parseComponentPackageFiles } from '../../src/renderer/components/importComponentPackage'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course'
import {
  createCourseProjectArchive,
  detectCourseProjectArchiveFormat,
  openCourseProjectArchive,
} from '../../src/renderer/project/courseProjectArchive'
import type { CourseProjectDocument, FlowBlock } from '../../src/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import { validateCourseProjectArchiveBytes } from '../../scripts/validate-project'
import {
  COURSE_PROJECT_REJECTION_INPUTS,
  COURSE_PROJECT_REJECTION_KIND,
  COURSE_PROJECT_V9_FIXTURE_IDS,
  COURSE_PROJECT_V9_FIXTURE_MTIME,
  listCourseProjectV9Fixtures,
  readCourseProjectV9FixtureArchive,
} from '../fixtures/course-project-v9'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_MODULE_URL = pathToFileURL(
  resolve(REPO_ROOT, 'scripts', 'build-architecture-baseline-fixtures.ts'),
).href

/** Resolves the tsx entry point from its manifest rather than a `dist/` guess. */
function resolveTsxCli(): string {
  const packageRoot = resolve(REPO_ROOT, 'node_modules', 'tsx')
  const { bin } = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const entry = typeof bin === 'string' ? bin : bin?.tsx
  if (!entry) throw new Error('Could not resolve the tsx CLI entry point')
  return resolve(packageRoot, entry)
}

const TSX_CLI = resolveTsxCli()

/**
 * fflate encodes ZIP DOS timestamps from the *local* calendar fields of the
 * supplied mtime, so an absolute-instant mtime re-encodes differently in every
 * timezone: the inner `.h5component` bytes change, its provenance `sha256`
 * changes inside `project.json`, and the outer `.h5lesson` DEFLATE output
 * changes with it. This probe rebuilds everything inside a child process so the
 * host timezone can actually be swapped, then reports byte digests plus the
 * provenance hashes recorded in `project.json`.
 */
const TIMEZONE_PROBE_PROGRAM = [
  'const fixtures = await import(process.env.ARCH0_FIXTURE_MODULE_URL)',
  'const built = fixtures.buildArchitectureBaselineFixtureOutputs()',
  "const { createHash } = await import('node:crypto')",
  "const { unzipSync } = await import('fflate')",
  'const outputs = {}',
  'for (const [name, bytes] of Object.entries(built.outputs)) {',
  '  outputs[name] = {',
  '    byteLength: bytes.byteLength,',
  "    sha256: createHash('sha256').update(bytes).digest('hex'),",
  '  }',
  '}',
  'const provenance = {}',
  'for (const fixture of built.manifest.fixtures) {',
  '  const files = unzipSync(built.outputs[fixture.filename])',
  "  const project = JSON.parse(new TextDecoder().decode(files['project.json']))",
  '  provenance[fixture.id] = Object.values(project.componentPackages).map((meta) => ({',
  '    sha256: meta.sha256,',
  '    contentSha256: meta.contentSha256,',
  '    importedAt: meta.importedAt,',
  '  }))',
  '}',
  'console.log(JSON.stringify({ outputs, provenance }))',
].join('\n')

interface TimezoneProbeResult {
  outputs: Record<string, { byteLength: number; sha256: string }>
  provenance: Record<
    string,
    Array<{ sha256?: string; contentSha256: string; importedAt?: string }>
  >
}

function buildFixturesInTimezone(timezone: string): TimezoneProbeResult {
  const stdout = execFileSync(
    process.execPath,
    [TSX_CLI, '--input-type=module', '--eval', TIMEZONE_PROBE_PROGRAM],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, TZ: timezone, ARCH0_FIXTURE_MODULE_URL: FIXTURE_MODULE_URL },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  const payload = stdout.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
  if (!payload) throw new Error(`Timezone probe produced no output for TZ=${timezone}`)
  return JSON.parse(payload) as TimezoneProbeResult
}

function probeResultFromLocalBuild(): TimezoneProbeResult {
  const built = buildArchitectureBaselineFixtureOutputs()
  const outputs: TimezoneProbeResult['outputs'] = {}
  for (const [name, bytes] of Object.entries(built.outputs)) {
    outputs[name] = {
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  const provenance: TimezoneProbeResult['provenance'] = {}
  for (const fixture of built.manifest.fixtures) {
    const files = unzipSync(built.outputs[fixture.filename] as Uint8Array)
    const project = JSON.parse(
      new TextDecoder().decode(files['project.json']),
    ) as CourseProjectDocument
    provenance[fixture.id] = Object.values(project.componentPackages).map((meta) => ({
      sha256: meta.sha256,
      contentSha256: meta.contentSha256,
      importedAt: meta.importedAt,
    }))
  }
  return { outputs, provenance }
}

function bytesFor(
  id: ArchitectureBaselineFixtureId,
  outputs = buildArchitectureBaselineFixtureOutputs().outputs,
): Uint8Array {
  const filename = `${id}.h5lesson`
  const bytes = outputs[filename]
  if (!bytes) throw new Error(`Missing generated fixture ${filename}`)
  return bytes
}

function open(id: ArchitectureBaselineFixtureId): ReturnType<typeof openCourseProjectArchive> {
  return openCourseProjectArchive(bytesFor(id))
}

function flattenFlowBlocks(blocks: readonly FlowBlock[]): FlowBlock[] {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === 'section' ? flattenFlowBlocks(block.blocks) : []),
  ])
}

function expectLegalExportableV9(id: ArchitectureBaselineFixtureId): CourseProjectDocument {
  const filename = `${id}.h5lesson`
  const bytes = bytesFor(id)
  const report = validateCourseProjectArchiveBytes(bytes, filename)
  expect(report.status).toBe('valid')
  expect(report.schema).toEqual({ valid: true, schemaVersion: 9, issues: [] })
  expect(report.fatal).toBeNull()
  expect(report.stableIds).toMatchObject({ valid: true, issues: [] })
  expect(report.migrationMarkers).toMatchObject({ present: false, items: [] })
  expect(report.summary.error).toBe(0)
  expect(report.summary.canExport).toBe(true)
  for (const target of ['single-html', 'web-package', 'pdf', 'pptx'] as const) {
    expect(report.exportPreflight?.[target].summary.canExport).toBe(true)
  }

  const files = unzipSync(bytes)
  const rawProject = JSON.parse(new TextDecoder().decode(files['project.json'])) as Record<
    string,
    unknown
  >
  expect(rawProject.schemaVersion).toBe(9)
  expect(rawProject).not.toHaveProperty('scenes')
  expect(rawProject).not.toHaveProperty('globalRuntime')
  expect(rawProject).not.toHaveProperty('globalNodes')
  return openCourseProjectArchive(bytes).project
}

describe('ARCH-0 representative Course Project V9 fixtures', () => {
  it('rebuilds all archives and the manifest byte-for-byte without V8 inputs', () => {
    const first = buildArchitectureBaselineFixtureOutputs()
    const second = buildArchitectureBaselineFixtureOutputs()
    expect(Object.keys(first.outputs).sort()).toEqual([
      'flow-heavy.h5lesson',
      'manifest.json',
      'mixed-spatial.h5lesson',
      'slide-heavy.h5lesson',
    ])
    expect(second.outputs).toEqual(first.outputs)
    expect(first.manifest.courseProjectSchemaVersion).toBe(9)
    expect(first.manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      'slide-heavy',
      'flow-heavy',
      'mixed-spatial',
    ])
    expect(first.manifest.fixtures.every((fixture) => fixture.sha256.length === 64)).toBe(true)

    for (const [filename, expected] of Object.entries(first.outputs)) {
      const onDisk = new Uint8Array(readFileSync(
        join(ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY, filename),
      ))
      expect(onDisk.byteLength).toBe(expected.byteLength)
      expect(onDisk.every((value, index) => value === expected[index])).toBe(true)
    }
    expect(ARCHITECTURE_BASELINE_FIXTURE_SPECS.map((fixture) => fixture.filename))
      .toEqual(first.manifest.fixtures.map((fixture) => fixture.filename))
  })

  it('rebuilds identical bytes and provenance hashes under UTC and Asia/Shanghai', () => {
    const utc = buildFixturesInTimezone('UTC')
    const shanghai = buildFixturesInTimezone('Asia/Shanghai')

    expect(shanghai).toEqual(utc)
    // Anchor both child runs to the committed bytes so they cannot drift
    // together: the first test already pins the in-process build to disk.
    expect(utc).toEqual(probeResultFromLocalBuild())

    expect(Object.keys(utc.outputs).sort()).toEqual([
      'flow-heavy.h5lesson',
      'manifest.json',
      'mixed-spatial.h5lesson',
      'slide-heavy.h5lesson',
    ])
    for (const [id, entries] of Object.entries(utc.provenance)) {
      expect(entries).toHaveLength(1)
      const [meta] = entries
      if (!meta) throw new Error(`Fixture ${id} recorded no component provenance`)
      // The ZIP timestamp changed, the recorded business instant must not.
      expect(meta.importedAt).toBe(ARCHITECTURE_BASELINE_FIXTURE_MTIME)
      expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(meta.contentSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(meta.sha256).not.toBe(meta.contentSha256)
    }
  }, 180_000)

  it('records complete, deterministic provenance for the synthetic component package', () => {
    const packageId = 'com.ittoedu.baseline.evidence-panel'
    const packageKey = `${packageId}@4.0.0`
    for (const id of ARCHITECTURE_BASELINE_FIXTURE_IDS) {
      const archive = open(id)
      const metadata = archive.project.componentPackages[packageId]
      if (!metadata) throw new Error(`Fixture ${id} declares no baseline component package`)
      expect(metadata.importedAt).toBe(ARCHITECTURE_BASELINE_FIXTURE_MTIME)
      expect(metadata.sourceLabel).toBe(`ARCH-0 synthetic fixture: ${packageKey}`)

      const packageFiles = archive.componentFiles[packageKey]
      if (!packageFiles) throw new Error(`Fixture ${id} carries no ${packageKey} files`)
      // Provenance hashes the reproducible raw `.h5component` bytes, while
      // `contentSha256` stays the packaging-independent content digest. The raw
      // bytes must be re-zipped with the timezone-stable ZIP timestamp, not the
      // business instant recorded in `importedAt`.
      const packageBytes = zipSync({ ...packageFiles }, {
        level: 6,
        mtime: ARCHITECTURE_BASELINE_FIXTURE_ZIP_MTIME,
      })
      expect(metadata.sha256).toBe(createHash('sha256').update(packageBytes).digest('hex'))
      expect(metadata.contentSha256).toBe(componentContentSha256(packageFiles))
      expect(metadata.sha256).not.toBe(metadata.contentSha256)
    }
  })

  it('covers Slide states, unified layers, media, component, playback and static inputs', () => {
    const project = expectLegalExportableV9('slide-heavy')
    const archive = open('slide-heavy')
    expect(project.id).toBe('arch-0-slide-heavy')
    expect(project.surfaces).toHaveLength(1)
    const surface = project.surfaces[0]
    expect(surface?.type).toBe('slide')
    if (!surface || surface.type !== 'slide') throw new Error('Expected Slide surface')

    expect(surface.scenes).toHaveLength(3)
    expect(surface.scenes[0]?.presentation?.states).toHaveLength(2)
    expect(surface.scenes.some((scene) => scene.interactions.length > 0)).toBe(true)
    const layers = [
      ...project.globalLayerItems.map((entry) => entry.item),
      ...surface.surfaceLayerItems.map((entry) => entry.item),
      ...surface.scenes.flatMap((scene) => scene.layerItems),
    ]
    expect(new Set(layers.map((item) => item.kind))).toEqual(
      new Set(['native', 'component', 'runtime']),
    )
    expect(new Set(layers.flatMap((item) => (
      item.kind === 'native' ? [item.content.nativeType] : []
    )))).toEqual(new Set(['text', 'teacher-controller', 'formula', 'image', 'shape']))
    expect(layers.some((item) => (
      item.kind === 'runtime' &&
      item.runtime.protocol === 'canvas-runtime' &&
      item.runtime.staticFallback?.coverage === 'scene'
    ))).toBe(true)
    expect(project.playback.controls).toBe('canvas')
    expect(project.locations).toHaveLength(4)
    expect(Object.values(project.assets).map((asset) => asset.kind).sort())
      .toEqual(['audio', 'image', 'image', 'image'])
    expect(Object.values(project.media.audio.sounds)).toHaveLength(1)
    expect(Object.keys(project.componentPackages)).toEqual([
      'com.ittoedu.baseline.evidence-panel',
    ])
    expect(Object.keys(archive.componentFiles)).toEqual([
      'com.ittoedu.baseline.evidence-panel@4.0.0',
    ])
  })

  it('covers Flow semantic blocks, IME content and a real FlowComponentBlock carrier', () => {
    const project = expectLegalExportableV9('flow-heavy')
    const archive = open('flow-heavy')
    expect(project.id).toBe('arch-0-flow-heavy')
    const surface = project.surfaces[0]
    expect(surface?.type).toBe('flow')
    if (!surface || surface.type !== 'flow') throw new Error('Expected Flow surface')

    const blocks = flattenFlowBlocks(surface.blocks)
    expect(new Set(blocks.map((block) => block.type))).toEqual(new Set([
      'heading',
      'paragraph',
      'list',
      'quote',
      'divider',
      'media',
      'table',
      'formula',
      'code',
      'callout',
      'section',
      'component',
    ]))
    const ime = blocks.find((block) => block.id === 'flow-ime-paragraph')
    expect(ime).toMatchObject({ type: 'paragraph' })
    expect(ime && 'text' in ime ? ime.text : '').toContain('中文输入法（IME）')
    expect(ime && 'runs' in ime ? ime.runs?.length : 0).toBeGreaterThan(0)
    const componentBlock = blocks.find((block) => block.type === 'component')
    expect(componentBlock).toMatchObject({
      type: 'component',
      component: { packageId: 'com.ittoedu.baseline.evidence-panel', version: '4.0.0' },
      staticFallbackAssetId: 'flow-component-fallback',
    })
    expect('layerItems' in surface).toBe(false)
    expect(surface.surfaceLayerItems[0]?.item.paperSpace).toBe('viewport')
    expect(Object.keys(archive.componentFiles)).toEqual([
      'com.ittoedu.baseline.evidence-panel@4.0.0',
    ])
  })

  it('covers Mixed navigation and Spatial camera, path, relation, component and Runtime', () => {
    const project = expectLegalExportableV9('mixed-spatial')
    const archive = open('mixed-spatial')
    expect(project.id).toBe('arch-0-mixed-spatial')
    expect(new Set(project.surfaces.map((surface) => surface.type))).toEqual(
      new Set(['slide', 'flow', 'spatial-2d']),
    )
    expect(project.surfaces.every((surface) => surface.surfaceLayerItems.length > 0)).toBe(true)
    expect(project.globalLayerItems.some((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))).toBe(true)
    expect(project.mixedPrintPlan?.entries.map((entry) => entry.kind)).toEqual([
      'slide-scenes',
      'flow-document',
      'spatial-frames',
    ])

    const spatial = project.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!spatial || spatial.type !== 'spatial-2d') throw new Error('Expected Spatial surface')
    expect(spatial.camera.frames).toHaveLength(2)
    expect(spatial.world.paths?.[0]?.layerItemIds).toEqual([
      'mixed-spatial-node-a',
      'mixed-spatial-component',
      'mixed-spatial-node-b',
    ])
    expect(spatial.world.relations).toHaveLength(1)
    expect(spatial.semanticZoom).toHaveLength(1)
    expect(new Set(spatial.world.layerItems.map((item) => item.kind))).toEqual(
      new Set(['native', 'component', 'runtime']),
    )
    expect(spatial.world.layerItems.some((item) => (
      item.kind === 'runtime' &&
      item.runtime.protocol === 'surface-runtime' &&
      item.runtime.runtimeApiVersion === 3 &&
      item.runtime.staticFallback?.coverage === 'surface'
    ))).toBe(true)
    expect(Object.keys(archive.componentFiles)).toEqual([
      'com.ittoedu.baseline.evidence-panel@4.0.0',
    ])
  })
})

function publishFromArchiveBytes(bytes: Uint8Array) {
  const opened = openCourseProjectArchive(bytes)
  const components = Object.fromEntries(
    Object.values(opened.componentFiles).map((files) => {
      const pkg = parseComponentPackageFiles(files)
      return [pkg.manifest.id, pkg]
    }),
  )
  const published = buildPublishedCourseV2Payload({
    project: opened.project,
    assetFiles: opened.assetFiles,
    components,
  })
  expect(publishedCourseV2Schema.parse(published)).toEqual(published)
  expect(published.format).toBe('h5course-published')
  expect(published.formatVersion).toBe(2)
  expect(published.sourceSchemaVersion).toBe(9)
  expect(published.courseId).toBe(opened.project.id)
  return { opened, published }
}

describe('r11-050 fixed Course Project V9 IDs', () => {
  it('binds PM-02–PM-28 onto the fixed fixture IDs without inventing new ones', () => {
    expect(listCourseProjectV9Fixtures().map((fixture) => fixture.id)).toEqual([
      ...COURSE_PROJECT_V9_FIXTURE_IDS,
    ])
    const covered = new Set<string>()
    for (const fixture of listCourseProjectV9Fixtures()) {
      for (const cover of fixture.covers) {
        if (cover.startsWith('PM-')) covered.add(cover)
      }
    }
    for (const spec of ARCHITECTURE_BASELINE_FIXTURE_SPECS) {
      for (const capability of spec.capabilities) {
        if (capability.startsWith('PM-')) covered.add(capability)
      }
    }
    const expected = Array.from({ length: 27 }, (_, index) => (
      `PM-${String(index + 2).padStart(2, '0')}`
    ))
    expect([...covered].sort()).toEqual(expected)
  })

  it.each([...COURSE_PROJECT_V9_FIXTURE_IDS])(
    're-archives sidecar/component bytes and publishes V9 fixture %s',
    (fixtureId) => {
      const bytes = readCourseProjectV9FixtureArchive(fixtureId)
      expect(detectCourseProjectArchiveFormat(bytes)).toMatchObject({
        kind: 'v9',
        identity: { schemaVersion: 9 },
      })
      const { opened } = publishFromArchiveBytes(bytes)
      const rebuilt = createCourseProjectArchive(opened, { mtime: COURSE_PROJECT_V9_FIXTURE_MTIME })
      const reopened = openCourseProjectArchive(rebuilt)
      expect(reopened.project).toEqual(opened.project)
      expect(Object.keys(reopened.assetFiles).sort()).toEqual(Object.keys(opened.assetFiles).sort())
      for (const [assetId, assetBytes] of Object.entries(opened.assetFiles)) {
        expect([...reopened.assetFiles[assetId]!]).toEqual([...assetBytes])
      }
      expect(Object.keys(reopened.componentFiles).sort()).toEqual(
        Object.keys(opened.componentFiles).sort(),
      )
    },
  )

  it.each([...ARCHITECTURE_BASELINE_FIXTURE_IDS])(
    'publishes architecture baseline %s from document and component bytes',
    (fixtureId) => {
      publishFromArchiveBytes(bytesFor(fixtureId))
    },
  )

  it.each([...COURSE_PROJECT_REJECTION_KIND])(
    'treats rejection input %s as unsupported or corrupted, never as V9',
    (kind) => {
      const bytes = COURSE_PROJECT_REJECTION_INPUTS[kind]
      const probe = detectCourseProjectArchiveFormat(bytes)
      expect(probe.kind).not.toBe('v9')
      if (kind === 'v8-unsupported' || kind === 'future-unsupported') {
        expect(probe.kind).toBe('unsupported')
        expect(probe.identity.schemaVersion).toBe(kind === 'v8-unsupported' ? 8 : 10)
      } else {
        expect(probe.kind).toBe('corrupted')
      }
      expect(() => openCourseProjectArchive(bytes)).toThrow()
    },
  )

  it('keeps render-host-benchmark as real V9 / Published V2 with host protocol and static fallback', () => {
    const exampleRoot = join(REPO_ROOT, 'examples', 'render-host-benchmark')
    const project = JSON.parse(
      readFileSync(join(exampleRoot, 'project-v9.json'), 'utf8'),
    ) as CourseProjectDocument
    const published = JSON.parse(
      readFileSync(join(exampleRoot, 'published-v2.json'), 'utf8'),
    ) as { format: string; formatVersion: number; sourceSchemaVersion: number }
    const html = readFileSync(join(exampleRoot, 'render-host-benchmark-v2.html'), 'utf8')
    const lesson = new Uint8Array(readFileSync(join(exampleRoot, 'render-host-benchmark-v9.h5lesson')))

    expect(project.schemaVersion).toBe(9)
    expect(detectCourseProjectArchiveFormat(lesson)).toMatchObject({
      kind: 'v9',
      identity: { schemaVersion: 9, projectId: project.id },
    })
    expect(published).toMatchObject({
      format: 'h5course-published',
      formatVersion: 2,
      sourceSchemaVersion: 9,
    })
    expect(html).toContain('h5course-published')
    expect(html).toContain('CoursewareRuntime.define')
    expect(html).toContain('staticFallback')
    expect(JSON.stringify(project)).toContain('CoursewareRuntime.define')
    expect(JSON.stringify(project)).toContain('staticFallback')
    expect(JSON.stringify(published)).toContain('staticFallback')
  })
})
