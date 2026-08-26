import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { cpus, freemem, release, totalmem, version as osVersion } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { componentPackagesFromArchive } from '../src/renderer/components/componentPackageStore'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
  type CourseProjectArchiveData,
} from '../src/renderer/project/courseProjectArchive'
import {
  openSlideAuthoringSession,
  redoSlideAuthoring,
  selectSlideLayers,
  transformSlideNativeLayers,
  undoSlideAuthoring,
  type SlideAuthoringSession,
} from '../src/renderer/course/slideAuthoringBackend'
import {
  commitFlowEditorHistory,
  createFlowEditorHistory,
  redoFlowEditorHistory,
  undoFlowEditorHistory,
} from '../src/renderer/course/flowEditorSlice'
import { updateFlowEditorBlock } from '../src/renderer/course/flowEditorCommands'
import { buildPublishedCourseV2Payload } from '../src/renderer/export/course/buildPublishedCourse'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackage,
} from '../src/renderer/export/course/buildCoursePackages'
import { buildFlowDocx } from '../src/renderer/export/course/flowDocx'
import { buildCoursePptx } from '../src/renderer/export/course/buildCoursePptx'
import { buildCoursePrintArtifacts } from '../src/renderer/export/course/buildCoursePrintArtifacts'
import {
  MixedCourseNavigator,
  mixedCourseDefinitionFromPublished,
  type MixedCoursePlayerPort,
} from '../src/player/surfaces/mixed/MixedCourseNavigator'
import type { PublishedCourseV2Payload } from '../src/shared/publishedCourseTypes'
import { validateCourseProjectArchiveBytes } from './validate-project'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const fixtureRoot = join(projectRoot, 'tests', 'fixtures', 'architecture-baseline')
const outputRoot = join(projectRoot, 'output', 'architecture-baseline')
const reportPath = join(outputRoot, 'node-measurements.json')
const electronProfile = join(outputRoot, 'electron-profile')
const playerBundlePath = join(projectRoot, 'dist-player', 'player.iife.js')
const FIXED_TIME = '2026-08-24T00:00:00.000Z'

const fixtureIds = ['slide-heavy', 'flow-heavy', 'mixed-spatial'] as const
type FixtureId = typeof fixtureIds[number]

interface TimingSummary {
  unit: 'ms'
  sampleCount: number
  warmupCount: number
  median: number
  p95: number
  min: number
  max: number
  samples: number[]
}

interface LoadedFixture {
  id: FixtureId
  filename: string
  path: string
  bytes: Uint8Array
  archive: CourseProjectArchiveData
  components: ReturnType<typeof componentPackagesFromArchive>
}

let blackhole = 0

function hash(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function round(value: number): number {
  return Number(value.toFixed(3))
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
}

function summarize(samples: number[], warmupCount: number): TimingSummary {
  const sorted = [...samples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
  return {
    unit: 'ms',
    sampleCount: samples.length,
    warmupCount,
    median: round(median),
    p95: round(percentile(sorted, 0.95)),
    min: round(sorted[0] ?? 0),
    max: round(sorted.at(-1) ?? 0),
    samples: samples.map(round),
  }
}

function measureSync(
  operation: () => unknown,
  sampleCount: number,
  warmupCount: number,
): TimingSummary {
  for (let index = 0; index < warmupCount; index += 1) operation()
  const samples: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now()
    const result = operation()
    blackhole += typeof result === 'string'
      ? result.length
      : result instanceof Uint8Array
        ? result.byteLength
        : result === undefined
          ? 0
          : 1
    samples.push(performance.now() - started)
  }
  return summarize(samples, warmupCount)
}

async function measureAsync(
  operation: () => Promise<unknown>,
  sampleCount: number,
  warmupCount: number,
): Promise<TimingSummary> {
  for (let index = 0; index < warmupCount; index += 1) await operation()
  const samples: number[] = []
  for (let index = 0; index < sampleCount; index += 1) {
    const started = performance.now()
    const result = await operation()
    blackhole += result === undefined ? 0 : 1
    samples.push(performance.now() - started)
  }
  return summarize(samples, warmupCount)
}

function loadFixture(id: FixtureId): LoadedFixture {
  const filename = `${id}.h5lesson`
  const path = join(fixtureRoot, filename)
  const bytes = new Uint8Array(readFileSync(path))
  const archive = openCourseProjectArchive(bytes)
  return {
    id,
    filename,
    path,
    bytes,
    archive,
    components: componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    ),
  }
}

function publish(fixture: LoadedFixture): PublishedCourseV2Payload {
  return buildPublishedCourseV2Payload({
    project: fixture.archive.project,
    assetFiles: fixture.archive.assetFiles,
    components: fixture.components,
  })
}

function saveAndReopen(fixture: LoadedFixture): CourseProjectArchiveData {
  const bytes = createCourseProjectArchive(fixture.archive, { mtime: FIXED_TIME })
  const reopened = openCourseProjectArchive(bytes)
  if (
    reopened.project.id !== fixture.archive.project.id ||
    reopened.project.revision !== fixture.archive.project.revision
  ) {
    throw new Error(`Archive round-trip changed ${fixture.id}`)
  }
  return reopened
}

function requireSlideSession(result: {
  ok: boolean
  nextSession?: SlideAuthoringSession
  reason?: string
}): SlideAuthoringSession {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? 'Slide command did not produce a session')
  }
  return result.nextSession
}

function slideTransformUndoRedo(fixture: LoadedFixture): number {
  let session = openSlideAuthoringSession(fixture.archive.project, {
    locationId: 'slide-location-practice',
    sessionId: 'arch-0-measure-slide',
  })
  session = requireSlideSession(selectSlideLayers(session, {
    nodeIds: ['slide-practice-title'],
  }))
  session = requireSlideSession(transformSlideNativeLayers(session, {
    nodes: [{
      nodeId: 'slide-practice-title',
      x: 88,
      y: 64,
      width: 720,
      height: 80,
      rotation: 0,
    }],
  }, { now: FIXED_TIME }))
  session = requireSlideSession(undoSlideAuthoring(session))
  session = requireSlideSession(redoSlideAuthoring(session))
  if (session.history.past.length !== 1 || session.history.future.length !== 0) {
    throw new Error('Slide transform did not preserve one-step history')
  }
  return session.history.present.revision
}

function flowEditUndoRedo(fixture: LoadedFixture): number {
  const result = updateFlowEditorBlock(
    fixture.archive.project,
    {
      surfaceId: 'flow-surface',
      blockId: 'flow-ime-paragraph',
      parentId: null,
    },
    { text: '中文输入法（IME）基线：春风又绿江南岸。' },
    { now: FIXED_TIME },
  )
  if (!result.ok || !result.nextDocument || !result.historyEntry) {
    throw new Error(result.reason ?? 'Flow edit did not commit')
  }
  let history = createFlowEditorHistory(fixture.archive.project)
  history = commitFlowEditorHistory(history, result.nextDocument)
  history = undoFlowEditorHistory(history)
  history = redoFlowEditorHistory(history)
  if (history.past.length !== 1 || history.future.length !== 0) {
    throw new Error('Flow edit did not preserve one-step history')
  }
  return history.present.revision
}

async function mixedNavigateAll(fixture: LoadedFixture): Promise<number> {
  const payload = publish(fixture)
  let activeSurfaceId: string | null = null
  const player: MixedCoursePlayerPort = {
    get activeSurfaceId() { return activeSurfaceId },
    async activateSurface(surfaceId) {
      activeSurfaceId = surfaceId
      return { ok: true }
    },
    async releaseSurfaceSession(surfaceId) {
      if (activeSurfaceId === surfaceId) activeSurfaceId = null
      return { ok: true }
    },
    async setSurfaceLocation() { return { ok: true } },
    async resetSurface() { return { ok: true } },
    async resetCourse() { return [] },
  }
  const navigator = new MixedCourseNavigator(
    mixedCourseDefinitionFromPublished(payload),
    player,
  )
  await navigator.start()
  while (navigator.canGoNext) await navigator.next()
  return navigator.getProgress().index
}

function measureMixedHistoryRetention(fixture: LoadedFixture): {
  commits: number
  historyDepth: number
  heapBeforeBytes: number
  heapAfterBytes: number
  heapDeltaBytes: number
  interpretation: string
} {
  let session = openSlideAuthoringSession(fixture.archive.project, {
    locationId: 'mixed-location-slide',
    sessionId: 'arch-0-mixed-history-observation',
  })
  session = requireSlideSession(selectSlideLayers(session, {
    nodeIds: ['mixed-slide-title'],
  }))
  const heapBeforeBytes = process.memoryUsage().heapUsed
  const commits = 50
  for (let index = 0; index < commits; index += 1) {
    session = requireSlideSession(transformSlideNativeLayers(session, {
      nodes: [{
        nodeId: 'mixed-slide-title',
        x: 65 + index,
        y: 48,
        width: 720,
        height: 80,
        rotation: 0,
      }],
    }, { now: FIXED_TIME }))
  }
  const heapAfterBytes = process.memoryUsage().heapUsed
  return {
    commits,
    historyDepth: session.history.past.length,
    heapBeforeBytes,
    heapAfterBytes,
    heapDeltaBytes: heapAfterBytes - heapBeforeBytes,
    interpretation: 'Diagnostic only: no forced GC, threshold or cross-machine comparison.',
  }
}

function parsePositiveInteger(
  argv: readonly string[],
  name: string,
  fallback: number,
): number {
  const prefix = `--${name}=`
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(`${name} must be an integer from 1 to 500`)
  }
  return parsed
}

function prepareElectronRecentProjects(fixtures: readonly LoadedFixture[]): string {
  const directory = join(electronProfile, 'project-data')
  mkdirSync(directory, { recursive: true })
  const recentPath = join(directory, 'recent-projects.json')
  writeFileSync(recentPath, `${JSON.stringify({
    version: 1,
    projects: [...fixtures].reverse().map((fixture, index) => ({
      path: fixture.path,
      name: fixture.filename,
      lastOpenedAt: 1_800_000_000_003 - index,
    })),
  }, null, 2)}\n`, 'utf8')
  return recentPath
}

function reportCounts(items: readonly { severity: 'error' | 'warning' | 'info' }[]) {
  return items.reduce((counts, item) => {
    counts[item.severity] += 1
    return counts
  }, { error: 0, warning: 0, info: 0 })
}

function writeEvidenceArtifact(
  fixtureId: FixtureId,
  filename: string,
  bytes: Uint8Array,
): { path: string; byteLength: number; sha256: string } {
  const directory = join(outputRoot, 'exports', fixtureId)
  mkdirSync(directory, { recursive: true })
  const safeFilename = filename
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\.+$/g, '')
  if (!safeFilename) throw new Error(`Unsafe empty evidence filename: ${filename}`)
  const artifactPath = join(directory, safeFilename)
  writeFileSync(artifactPath, bytes)
  return {
    path: relative(projectRoot, artifactPath).replaceAll('\\', '/'),
    byteLength: bytes.byteLength,
    sha256: hash(bytes),
  }
}

function withFormulaCanvasDocument<T>(
  pngDataUrl: string,
  operation: () => Promise<T>,
): Promise<T> {
  const globals = globalThis as unknown as Record<string, unknown>
  const previousDocument = globals.document
  if (previousDocument !== undefined) return operation()
  const context: Record<string, unknown> = {
    font: '16px sans-serif',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'round',
    lineJoin: 'round',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
    measureText(value: string) {
      const size = Number(/([0-9.]+)px/.exec(String(context.font))?.[1] ?? 16)
      return { width: Math.max(size * 0.22, Array.from(value).length * size * 0.62) }
    },
    scale() {},
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
  }
  globals.document = {
    createElement(tagName: string) {
      if (tagName !== 'canvas') throw new Error(`Baseline canvas shim rejects ${tagName}`)
      return {
        width: 1,
        height: 1,
        getContext(kind: string) {
          return kind === '2d' ? context : null
        },
        toDataURL() { return pngDataUrl },
      }
    },
  }
  return operation().finally(() => {
    delete globals.document
  })
}

async function captureConsoleErrors<T>(
  operation: () => Promise<T>,
): Promise<{ value: T; messages: string[] }> {
  const messages: string[] = []
  const original = console.error
  console.error = (...values: unknown[]) => {
    messages.push(values.map((value) => (
      value instanceof Error ? value.message : String(value)
    )).join(' '))
  }
  try {
    return { value: await operation(), messages }
  } finally {
    console.error = original
  }
}

async function buildOneShotExportEvidence(
  fixtures: readonly LoadedFixture[],
): Promise<Record<string, unknown>> {
  const evidence: Record<string, unknown> = {}
  for (const fixture of fixtures) {
    const published = publish(fixture)
    const resolveAssetBytes = (assetId: string) => {
      const metadata = fixture.archive.project.assets[assetId]
      const bytes = fixture.archive.assetFiles[assetId]
      return metadata && bytes
        ? { bytes, mimeType: metadata.mimeType, filename: metadata.filename }
        : undefined
    }
    const print = await buildCoursePrintArtifacts(published, { resolveAssetBytes })
    const printArtifacts = print.files.map((file) => ({
      kind: file.kind,
      surfaceId: file.surfaceId ?? null,
      pageId: file.pageId ?? null,
      ...writeEvidenceArtifact(fixture.id, file.filename, file.bytes),
    }))
    const fixtureEvidence: Record<string, unknown> = {
      printArtifacts: {
        status: print.report.some((item) => item.severity === 'error')
          ? 'red'
          : print.report.some((item) => item.severity === 'warning')
            ? 'green-partial'
            : 'green',
        pageCount: print.pages.length,
        fileCount: print.files.length,
        files: printArtifacts,
        reportCounts: reportCounts(print.report),
        report: print.report,
        warnings: print.warnings,
      },
    }
    if (fixture.id === 'slide-heavy' || fixture.id === 'mixed-spatial') {
      const pngDataUrl = Object.values(published.assets)
        .find((asset) => asset.mimeType === 'image/png' && asset.url.startsWith('data:image/png'))
        ?.url
      if (!pngDataUrl) throw new Error(`${fixture.id} has no PNG for the formula canvas shim`)
      const pptxRun = await captureConsoleErrors(() => withFormulaCanvasDocument(
        pngDataUrl,
        () => buildCoursePptx(published),
      ))
      const pptx = pptxRun.value
      fixtureEvidence.pptx = {
        status: pptxRun.messages.length > 0 || pptx.report.some((item) => item.severity === 'error')
          ? 'red'
          : pptx.warnings.length > 0
            ? 'green-with-fallback-warnings'
            : 'green',
        slideCount: pptx.slideCount,
        pageCount: pptx.pages.length,
        artifact: writeEvidenceArtifact(
          fixture.id,
          `${fixture.id}.pptx`,
          pptx.bytes,
        ),
        reportCounts: reportCounts(pptx.report),
        report: pptx.report,
        warnings: pptx.warnings,
        libraryMessages: pptxRun.messages,
      }
    }
    evidence[fixture.id] = fixtureEvidence
  }
  return evidence
}

async function main(argv: readonly string[]): Promise<void> {
  const sampleCount = parsePositiveInteger(argv, 'samples', 21)
  const warmupCount = parsePositiveInteger(argv, 'warmup', 5)
  const prepareElectron = argv.includes('--prepare-electron')
  if (argv.some((argument) => (
    argument !== '--prepare-electron' && !/^--(?:samples|warmup)=\d+$/.test(argument)
  ))) {
    throw new Error('Usage: npx tsx scripts/measure-architecture-baseline.ts [--samples=N] [--warmup=N] [--prepare-electron]')
  }
  const fixtures = fixtureIds.map(loadFixture)
  const playerBundleAvailable = existsSync(playerBundlePath)
  const playerBundle = playerBundleAvailable ? readFileSync(playerBundlePath, 'utf8') : ''
  const fixtureMetrics = Object.fromEntries(fixtures.map((fixture) => {
    const sources = {
      project: fixture.archive.project,
      assetFiles: fixture.archive.assetFiles,
      components: fixture.components,
    }
    return [fixture.id, {
      archiveOpen: measureSync(
        () => openCourseProjectArchive(fixture.bytes),
        sampleCount,
        warmupCount,
      ),
      archiveSaveReopen: measureSync(
        () => saveAndReopen(fixture),
        sampleCount,
        warmupCount,
      ),
      validationAndExportPreflight: measureSync(
        () => validateCourseProjectArchiveBytes(fixture.bytes, fixture.filename),
        sampleCount,
        warmupCount,
      ),
      publishedV2Build: measureSync(
        () => buildPublishedCourseV2Payload(sources),
        sampleCount,
        warmupCount,
      ),
      standaloneHtmlBuild: playerBundleAvailable
        ? measureSync(
            () => buildPublishedCourseStandaloneHtml(sources, playerBundle),
            sampleCount,
            warmupCount,
          )
        : null,
      webPackageBuild: playerBundleAvailable
        ? measureSync(
            () => buildPublishedCourseWebPackage(sources, playerBundle),
            sampleCount,
            warmupCount,
          )
        : null,
    }]
  }))

  const slide = fixtures.find((fixture) => fixture.id === 'slide-heavy')!
  const flow = fixtures.find((fixture) => fixture.id === 'flow-heavy')!
  const mixed = fixtures.find((fixture) => fixture.id === 'mixed-spatial')!
  const flowPublished = publish(flow)
  const flowSurface = flowPublished.surfaces.find((surface) => surface.type === 'flow')
  if (!flowSurface || flowSurface.type !== 'flow') throw new Error('Flow fixture lost its Flow surface')
  const docx = () => buildFlowDocx(flowSurface, {
    createdAt: new Date(FIXED_TIME),
    resolveAsset(assetId) {
      const meta = flow.archive.project.assets[assetId]
      const bytes = flow.archive.assetFiles[assetId]
      return meta && bytes
        ? { bytes, mimeType: meta.mimeType, filename: meta.filename }
        : undefined
    },
  }).bytes
  const oneShotExports = await buildOneShotExportEvidence(fixtures)

  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    protocol: {
      clock: 'node:perf_hooks.performance.now',
      sampleCount,
      warmupCount,
      statistic: 'median and nearest-rank P95 over measured samples',
      order: fixtureIds,
      fixedFixtureMtime: FIXED_TIME,
      note: 'Absolute numbers are a same-machine baseline, not a release threshold.',
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      osRelease: release(),
      osVersion: osVersion(),
      cpuModel: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtStart: freemem(),
    },
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      path: relative(projectRoot, fixture.path).replaceAll('\\', '/'),
      byteLength: fixture.bytes.byteLength,
      sha256: hash(fixture.bytes),
      projectId: fixture.archive.project.id,
      revision: fixture.archive.project.revision,
      locations: fixture.archive.project.locations.length,
      surfaces: fixture.archive.project.surfaces.length,
    })),
    playerBundle: playerBundleAvailable
      ? {
          status: 'available',
          path: relative(projectRoot, playerBundlePath).replaceAll('\\', '/'),
          byteLength: Buffer.byteLength(playerBundle),
          sha256: hash(playerBundle),
          modifiedAt: statSync(playerBundlePath).mtime.toISOString(),
          provenance: 'Existing ignored build artifact; pipeline freshness is not inferred.',
        }
      : {
          status: 'missing',
          path: relative(projectRoot, playerBundlePath).replaceAll('\\', '/'),
          provenance: 'HTML/Web timing is unknown until a player bundle exists.',
        },
    metrics: {
      fixtures: fixtureMetrics,
      slideTransformUndoRedo: measureSync(
        () => slideTransformUndoRedo(slide),
        sampleCount,
        warmupCount,
      ),
      flowApplyTextUndoRedo: measureSync(
        () => flowEditUndoRedo(flow),
        sampleCount,
        warmupCount,
      ),
      mixedNavigateAllLocations: await measureAsync(
        () => mixedNavigateAll(mixed),
        sampleCount,
        warmupCount,
      ),
      flowDocxBuild: measureSync(docx, sampleCount, warmupCount),
    },
    mixedHistoryObservation: measureMixedHistoryRetention(mixed),
    oneShotExports,
    functionalEvidence: {
      archiveOpen: { status: 'green', scope: 'all three fixtures through openCourseProjectArchive' },
      saveReopen: { status: 'green', scope: 'deterministic in-memory archive save/reopen; native Save As dialog not covered' },
      undoRedo: { status: 'green', scope: 'Slide transform and Flow text document histories' },
      switchLocation: { status: 'green', scope: 'all four Mixed Published V2 locations via MixedCourseNavigator' },
      dragCommit: { status: 'green', scope: 'one Slide transform command/one history entry; trusted pointer UI not covered' },
      flowIme: { status: 'unknown', scope: 'dedicated jsdom composition protocol test is separate; real OS IME is not inferred' },
      previewMountDestroy: { status: 'unknown', scope: 'dedicated integration/Electron evidence is separate' },
      exports: {
        status: playerBundleAvailable ? 'green-partial' : 'unknown',
        scope: 'actual in-memory HTML/Web/DOCX; PDF/PPTX actual writes are not inferred from preflight',
      },
    },
    blackhole,
  }

  mkdirSync(outputRoot, { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`Architecture baseline measurements: ${relative(projectRoot, reportPath).replaceAll('\\', '/')}`)
  if (prepareElectron) {
    const recentPath = prepareElectronRecentProjects(fixtures)
    console.log(`Electron recent-project seed: ${relative(projectRoot, recentPath).replaceAll('\\', '/')}`)
  }
  console.log(`Samples: ${sampleCount}; warmups: ${warmupCount}`)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
