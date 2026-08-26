// @vitest-environment node
// 本文件会嵌套执行 vite 打包（esbuild）；jsdom 的 TextEncoder 破坏 esbuild 的
// Uint8Array invariant，因此必须在 node 环境下运行。
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { componentManifestSchema } from '../../src/shared/componentSchema'
import type { ComponentManifest } from '../../src/shared/componentTypes'
import { projectDocumentSchema } from '../../src/shared/projectSchema'
import type { ProjectDocument } from '../../src/shared/projectTypes'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '../../src/shared/publishedCourseSchema'
import type { PublishedCourseV2Payload } from '../../src/shared/publishedCourseTypes'
import { importComponentPackage } from '../../src/renderer/components/importComponentPackage'
import { openProjectArchive } from '../../src/renderer/project/projectArchive'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import {
  checkRenderHostBenchmarkOutputs,
  RENDER_HOST_BENCHMARK_OUTPUT_PATHS,
  RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
} from '../../scripts/build-render-host-benchmark'
import { equalBytes } from '../../scripts/exampleGenerationBoundary'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDirectory, '..', '..')
const exampleDirectory = path.join(projectRoot, 'examples', 'render-host-benchmark')
const runtimeDirectory = path.join(exampleDirectory, 'runtimes')
const tableDirectory = path.join(exampleDirectory, 'components', 'editable-table')
const phaserMeterDirectory = path.join(exampleDirectory, 'components', 'phaser-meter')
const MAX_RUNTIME_BYTES = 2 * 1024 * 1024

let project: ProjectDocument
let threeBundle = ''
let phaserRuntime = ''
let tableManifest: ComponentManifest
let phaserMeterManifest: ComponentManifest
let tableRuntime = ''
let phaserMeterRuntime = ''
let declaredThreeVersion = ''

const frozenV8ArtifactHashes = {
  'render-host-benchmark.h5lesson': '8beb9feab7858df6f66db7b49c5090b8bed47b2ce0c2f76d4ffd0b47857a2ca9',
  'render-host-editable-table.h5component': 'fd695aef3bb5416c1c4d5e9555b3475da2dedeba45445cf6b73637b9558cd234',
  'render-host-phaser-meter.h5component': 'b77013e2620c60e43c303390c5580138005c30d82fec628c2e8a7539f1420d3d',
  // Reviewed prerequisite 95a49d9 removed legacy teacher-escape chrome; this
  // is the rebased frozen input, not V8-05A accepting fixture drift.
  'render-host-benchmark.html': '3ba5198ed855caadf97d719c4e078dc5be2507fc9cd9bf5a978e68b1f12d633c',
  'project.json': 'fcee1f76fdd83f4f1bf7f24316ce6ddc8e52b259ae840179fa52835dd28cb93d',
  'THIRD_PARTY_NOTICES.md': 'a10971d922496b85d213d177d4fd8fd6e3391998a3b66fba3b09f18e43933e2b',
} as const

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readDeclaredThreeVersion(packageValue: unknown): string {
  const version = isRecord(packageValue) && isRecord(packageValue.devDependencies)
    ? packageValue.devDependencies.three
    : undefined
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('package.json must pin devDependencies.three to an exact version')
  }
  return version
}

function executeRuntimeRegistration(source: string): unknown {
  let definition: unknown
  const api = {
    define(candidate: unknown) {
      if (definition !== undefined) throw new Error('runtime duplicate registration')
      definition = candidate
    },
  }
  const runtimeWindow = { CoursewareRuntime: api }
  const runtimeGlobal = { CoursewareRuntime: api }
  const execute = new Function(
    'window',
    'globalThis',
    'CoursewareRuntime',
    `"use strict";\n${source}`,
  ) as (
    windowValue: typeof runtimeWindow,
    globalValue: typeof runtimeGlobal,
    apiValue: typeof api,
  ) => void
  execute(runtimeWindow, runtimeGlobal, api)
  return definition
}

function executeComponentRegistration(source: string): unknown {
  let definition: unknown
  const runtimeWindow = {
    CoursewareComponent: {
      define(candidate: unknown) {
        if (definition !== undefined) throw new Error('component duplicate registration')
        definition = candidate
      },
    },
  }
  const execute = new Function('window', `"use strict";\n${source}`) as (
    windowValue: typeof runtimeWindow,
  ) => void
  execute(runtimeWindow)
  return definition
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(entryPath)
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [entryPath] : []
  }))
  return nested.flat()
}

interface ThreeDependencyReference {
  file: string
  line: number
  kind: 'import' | 'export' | 'dynamic-import' | 'require'
  specifier: string
}

function findThreeDependencyReferences(filePath: string, source: string): ThreeDependencyReference[] {
  const references: ThreeDependencyReference[] = []
  const patterns: Array<{
    kind: ThreeDependencyReference['kind']
    pattern: RegExp
  }> = [
    {
      kind: 'import',
      pattern: /^\s*import\s+(?!\()(?:type\s+)?(?:[^'";]*?\s+from\s+)?["'](three(?:\/[^"']*)?)["']/gm,
    },
    {
      kind: 'export',
      pattern: /^\s*export\s+(?:type\s+)?(?:\*[^'";]*|\{[^}]*\})\s+from\s+["'](three(?:\/[^"']*)?)["']/gm,
    },
    {
      kind: 'dynamic-import',
      pattern: /\bimport\s*\(\s*["'](three(?:\/[^"']*)?)["']\s*\)/g,
    },
    {
      kind: 'require',
      pattern: /\brequire(?:\.resolve)?\s*\(\s*["'](three(?:\/[^"']*)?)["']\s*\)/g,
    },
  ]
  for (const { kind, pattern } of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier === undefined || match.index === undefined) continue
      references.push({
        file: path.relative(projectRoot, filePath).replaceAll('\\', '/'),
        line: source.slice(0, match.index).split(/\r?\n/).length,
        kind,
        specifier,
      })
    }
  }
  return references.sort((left, right) => left.line - right.line)
}

beforeAll(async () => {
  const [
    projectValue,
    threeSource,
    phaserSource,
    tableManifestValue,
    phaserMeterManifestValue,
    tableSource,
    phaserMeterSource,
    rootPackageValue,
  ] = await Promise.all([
    readJson(path.join(exampleDirectory, 'project.json')),
    fs.readFile(path.join(runtimeDirectory, 'three-runtime.js'), 'utf8'),
    fs.readFile(path.join(runtimeDirectory, 'phaser-runtime.js'), 'utf8'),
    readJson(path.join(tableDirectory, 'manifest.json')),
    readJson(path.join(phaserMeterDirectory, 'manifest.json')),
    fs.readFile(path.join(tableDirectory, 'runtime.js'), 'utf8'),
    fs.readFile(path.join(phaserMeterDirectory, 'runtime.js'), 'utf8'),
    readJson(path.join(projectRoot, 'package.json')),
  ])
  project = projectDocumentSchema.parse(projectValue)
  threeBundle = threeSource
  phaserRuntime = phaserSource
  tableManifest = componentManifestSchema.parse(tableManifestValue)
  phaserMeterManifest = componentManifestSchema.parse(phaserMeterManifestValue)
  tableRuntime = tableSource
  phaserMeterRuntime = phaserMeterSource
  declaredThreeVersion = readDeclaredThreeVersion(rootPackageValue)
})

describe('render host benchmark fixture', () => {
  it('regenerates all tracked outputs deterministically and checks them without writing', async () => {
    const snapshot = async () => new Map(await Promise.all(
      Object.values(RENDER_HOST_BENCHMARK_OUTPUT_PATHS).map(
        async (relativePath) => [relativePath, new Uint8Array(await fs.readFile(
          path.join(exampleDirectory, relativePath),
        ))] as const,
      ),
    ))
    const before = await snapshot()
    await checkRenderHostBenchmarkOutputs()
    const after = await snapshot()
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [relativePath, bytes] of before) {
      expect(equalBytes(after.get(relativePath)!, bytes)).toBe(true)
    }
  }, 120_000)

  it('is a complete Project V8 document with one scene for each route', () => {
    expect(project.schemaVersion).toBe(8)
    expect(project.scenes.map(({ id }) => id)).toEqual([
      'scene_native_nodes',
      'scene_runtime_phaser',
      'scene_runtime_three',
      'scene_component_v4_dom',
      'scene_component_v4_phaser',
    ])
    expect(project.globalLayer).toHaveLength(1)
    expect(project.globalInteractions).toEqual([])
    expect(project.playback).toEqual({
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    })
    expect(project.scenes.every((scene) => Array.isArray(scene.interactions))).toBe(true)

    const [nativeScene, phaserScene, threeScene, tableScene, phaserComponentScene] = project.scenes
    expect(nativeScene?.runtime).toBeUndefined()
    expect(nativeScene?.nodes.some((node) => node.type === 'external-component')).toBe(false)
    expect(phaserScene?.runtime).toMatchObject({ runtimeApiVersion: 2, renderMode: 'phaser' })
    expect(threeScene?.runtime).toMatchObject({ runtimeApiVersion: 2, renderMode: 'dom' })
    expect(threeScene?.runtime?.source).toBe(threeBundle)
    expect(tableScene?.nodes).toContainEqual(expect.objectContaining({
      type: 'external-component',
      component: { packageId: tableManifest.id, version: tableManifest.version },
    }))
    expect(phaserComponentScene?.nodes).toContainEqual(expect.objectContaining({
      type: 'external-component',
      component: { packageId: phaserMeterManifest.id, version: phaserMeterManifest.version },
    }))

    expect(Object.values(project.assets).every(({ kind }) => kind === 'image')).toBe(true)
    expect(JSON.stringify(project.assets)).not.toContain('"model"')
  })

  it('registers both one-off runtimes as API 2 definitions', () => {
    const phaserDefinition = executeRuntimeRegistration(phaserRuntime)
    const threeDefinition = executeRuntimeRegistration(threeBundle)
    expect(phaserDefinition).toMatchObject({
      runtimeApiVersion: 2,
      create: expect.any(Function),
    })
    expect(threeDefinition).toMatchObject({
      runtimeApiVersion: 2,
      create: expect.any(Function),
    })
  })

  it('ships Three.js inside a single offline IIFE under the runtime size limit', async () => {
    const bundleBytes = new TextEncoder().encode(threeBundle).byteLength
    expect(bundleBytes).toBeLessThan(MAX_RUNTIME_BYTES)
    expect(threeBundle).toContain('CoursewareRuntime.define')
    expect(threeBundle).not.toMatch(/(^|[;\n\r])\s*import\s*(?:[(\s{*]|["'])/m)
    expect(threeBundle).not.toMatch(/(^|[;\n\r])\s*export\s+(?:default|const|let|var|function|class|\{|\*)/m)
    expect(threeBundle).not.toMatch(/\brequire\s*\(/)

    const entry = await fs.readFile(path.join(runtimeDirectory, 'three-runtime.entry.ts'), 'utf8')
    expect(entry).toContain("from 'three'")
    expect(entry).toContain('prepareCapture()')
    expect(entry).toContain('cancelAnimationFrame')
    expect(entry).toContain('removeEventListener')
    expect(entry).toContain('geometry.dispose()')
    expect(entry).toContain('material.dispose()')
    expect(entry).toContain('renderer.dispose()')
    expect(entry).toContain('renderer.forceContextLoss()')
  })

  it('keeps Three.js module dependencies out of the entire core source tree', async () => {
    const probePath = path.join(projectRoot, 'src', '__three_dependency_probe.ts')
    expect(findThreeDependencyReferences(
      probePath,
      "type ThreeRenderMode = 'three'\nconst description = 'Three.js is an optional enhancement'",
    )).toEqual([])
    expect(findThreeDependencyReferences(
      probePath,
      "import type { Scene } from 'three'\nvoid import('three/addons/loaders/GLTFLoader.js')\nrequire('three')",
    ).map(({ kind, specifier }) => ({ kind, specifier }))).toEqual([
      { kind: 'import', specifier: 'three' },
      { kind: 'dynamic-import', specifier: 'three/addons/loaders/GLTFLoader.js' },
      { kind: 'require', specifier: 'three' },
    ])

    const files = await sourceFiles(path.join(projectRoot, 'src'))
    const sources = await Promise.all(files.map(async (filePath) => ({
      filePath,
      source: await fs.readFile(filePath, 'utf8'),
    })))
    const references = sources.flatMap(({ filePath, source }) =>
      findThreeDependencyReferences(filePath, source))
    expect(references).toEqual([])
  })

  it('contains V4 DOM and Phaser components on their declared surfaces', () => {
    expect(tableManifest).toMatchObject({
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene', 'global'],
    })
    expect(tableManifest.defaultProps).toHaveProperty('content.rows')
    expect(tableRuntime).toContain('ctx.dom.root')
    expect(tableRuntime).toContain('ctx.capture.waitUntil')
    expect(tableRuntime).toContain('prepareCapture')
    expect(tableRuntime).toContain('removeEventListener')

    expect(phaserMeterManifest).toMatchObject({
      schemaVersion: 4,
      runtimeApiVersion: 4,
      supportedScopes: ['scene'],
      renderMode: 'phaser',
    })
    expect(phaserMeterRuntime).toContain('ctx.phaser.scene')
    expect(phaserMeterRuntime).toContain('ctx.phaser.root')
    expect(phaserMeterRuntime).not.toContain('__renderHostPhaserMeterGenerationProbe')

    expect(executeComponentRegistration(tableRuntime)).toMatchObject({
      id: tableManifest.id,
      runtimeApiVersion: 4,
      create: expect.any(Function),
    })
    expect(executeComponentRegistration(phaserMeterRuntime)).toMatchObject({
      id: phaserMeterManifest.id,
      runtimeApiVersion: 4,
      create: expect.any(Function),
    })
  })

  it('reopens the lesson and both component archives with current import paths', async () => {
    const [lessonBytes, tableBytes, phaserMeterBytes] = await Promise.all([
      fs.readFile(path.join(exampleDirectory, 'render-host-benchmark.h5lesson')),
      fs.readFile(path.join(exampleDirectory, 'render-host-editable-table.h5component')),
      fs.readFile(path.join(exampleDirectory, 'render-host-phaser-meter.h5component')),
    ])
    const reopened = openProjectArchive(lessonBytes)
    expect(reopened.project.scenes).toHaveLength(5)
    expect(Object.keys(reopened.componentFiles)).toHaveLength(2)
    expect(importComponentPackage(tableBytes).manifest.schemaVersion).toBe(4)
    expect(importComponentPackage(phaserMeterBytes).manifest.schemaVersion).toBe(4)
  })

  it('ships an offline standalone player and the Three.js MIT notice beside it', async () => {
    const [html, notice, noticeStat, installedPackage, installedLicense] = await Promise.all([
      fs.readFile(path.join(exampleDirectory, 'render-host-benchmark.html'), 'utf8'),
      fs.readFile(path.join(exampleDirectory, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
      fs.stat(path.join(exampleDirectory, 'THIRD_PARTY_NOTICES.md')),
      readJson(path.join(projectRoot, 'node_modules', 'three', 'package.json')),
      fs.readFile(path.join(projectRoot, 'node_modules', 'three', 'LICENSE'), 'utf8'),
    ])
    expect(html).toContain('window.__H5_LESSON_PAYLOAD__=')
    expect(html).toContain('connect-src data: blob:')
    expect(html).not.toMatch(/connect-src[^;]*(?:https?:|\*|'self')/i)
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(noticeStat.isFile()).toBe(true)
    expect(installedPackage).toMatchObject({ version: declaredThreeVersion, license: 'MIT' })
    expect(notice).toContain(`## Three.js ${declaredThreeVersion}`)
    expect(notice.endsWith(`${installedLicense.trim()}\n`)).toBe(true)
    expect(notice).toContain('https://github.com/mrdoob/three.js')
    expect(notice).toContain('The MIT License')
    expect(notice).toContain('runtimes/three-runtime.js')
  })

  it('keeps every frozen Project V8 release artifact byte-identical', async () => {
    for (const [relativePath, expectedHash] of Object.entries(frozenV8ArtifactHashes)) {
      const bytes = await fs.readFile(path.join(exampleDirectory, relativePath))
      expect(createHash('sha256').update(bytes).digest('hex'), relativePath).toBe(expectedHash)
    }
  })

  it('authors a reopenable five-page Course Project V9 through the current carriers', async () => {
    const [projectValue, archiveBytes] = await Promise.all([
      readJson(path.join(exampleDirectory, RENDER_HOST_BENCHMARK_OUTPUT_PATHS.projectV9)),
      fs.readFile(path.join(exampleDirectory, RENDER_HOST_BENCHMARK_OUTPUT_PATHS.lessonV9)),
    ])
    const projectV9: CourseProjectDocument = courseProjectDocumentSchema.parse(projectValue)
    const reopened = openCourseProjectArchive(archiveBytes)
    expect(reopened.project).toEqual(projectV9)
    expect(projectV9.schemaVersion).toBe(9)
    expect(projectV9.id).toBe('project_render_host_benchmark_v9')
    expect(projectV9.revision).toBeGreaterThan(10)
    expect(projectV9.locations.map(({ id }) => id)).toEqual([
      'scene_native_nodes_v9',
      'scene_runtime_phaser_v9',
      'scene_runtime_three_v9',
      'scene_component_v4_dom_v9',
      'scene_component_v4_phaser_v9',
    ])
    expect(projectV9.startLocationId).toBe('scene_native_nodes_v9')
    expect(projectV9.globalLayerItems).toHaveLength(1)
    expect(projectV9.globalLayerItems[0]?.item.kind).toBe('native')

    const surface = projectV9.surfaces[0]
    expect(surface?.type).toBe('slide')
    if (!surface || surface.type !== 'slide') throw new Error('V9 benchmark lost its Slide surface')
    expect(surface.scenes).toHaveLength(5)
    const [native, phaser, three, table, meter] = surface.scenes
    expect(native?.layerItems.map(({ layerItemId }) => layerItemId)).toEqual([
      'native_click_target_v9',
      'native_click_probe_v9',
    ])
    expect(native?.interactions).toContainEqual(expect.objectContaining({
      id: 'native_click_rule_v9',
      trigger: { type: 'node.click', nodeId: 'native_click_target_v9' },
    }))
    expect(phaser?.layerItems).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      layerItemId: 'phaser_runtime_instance_v9',
      runtime: expect.objectContaining({
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        renderMode: 'phaser',
      }),
    }))
    expect(three?.layerItems).toContainEqual(expect.objectContaining({
      kind: 'runtime',
      layerItemId: 'three_runtime_instance_v9',
      runtime: expect.objectContaining({
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        renderMode: 'dom',
        source: threeBundle.trim(),
      }),
    }))
    expect(table?.layerItems).toContainEqual(expect.objectContaining({
      kind: 'component',
      layerItemId: 'table_component_instance',
      component: { packageId: tableManifest.id, version: tableManifest.version },
    }))
    expect(meter?.layerItems).toContainEqual(expect.objectContaining({
      kind: 'component',
      layerItemId: 'phaser_meter_component_instance',
      component: {
        packageId: phaserMeterManifest.id,
        version: RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
      },
    }))
    expect(projectV9.componentPackages[phaserMeterManifest.id]?.version)
      .toBe(RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION)
    expect(Object.keys(reopened.componentFiles).sort()).toEqual([
      `${tableManifest.id}@${tableManifest.version}`,
      `${phaserMeterManifest.id}@${RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION}`,
    ].sort())
    const embeddedManifest = (key: string) => componentManifestSchema.parse(JSON.parse(
      new TextDecoder().decode(reopened.componentFiles[key]!['manifest.json']!),
    ) as unknown)
    expect(embeddedManifest(`${tableManifest.id}@${tableManifest.version}`).renderMode).toBe('dom')
    const embeddedMeterKey =
      `${phaserMeterManifest.id}@${RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION}`
    const embeddedMeter = embeddedManifest(embeddedMeterKey)
    expect(embeddedMeter).toMatchObject({
      id: phaserMeterManifest.id,
      version: RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
      renderMode: 'phaser',
    })
    expect(new TextDecoder().decode(
      reopened.componentFiles[embeddedMeterKey]![embeddedMeter.entry]!,
    )).toContain('__renderHostPhaserMeterGenerationProbe')
  })

  it('ships the same five routes as a Published Course V2 standalone', async () => {
    const [payloadValue, html, notice] = await Promise.all([
      readJson(path.join(exampleDirectory, RENDER_HOST_BENCHMARK_OUTPUT_PATHS.publishedV2)),
      fs.readFile(path.join(exampleDirectory, RENDER_HOST_BENCHMARK_OUTPUT_PATHS.htmlV2), 'utf8'),
      fs.readFile(path.join(exampleDirectory, RENDER_HOST_BENCHMARK_OUTPUT_PATHS.noticesV9), 'utf8'),
    ])
    const payload: PublishedCourseV2Payload = publishedCourseV2Schema.parse(payloadValue)
    expect(payload).toMatchObject({
      format: 'h5course-published',
      formatVersion: 2,
      sourceSchemaVersion: 9,
      courseId: 'project_render_host_benchmark_v9',
    })
    expect(payload.locations).toHaveLength(5)
    expect(Object.keys(payload.components).sort()).toEqual([
      `${tableManifest.id}@${tableManifest.version}`,
      `${phaserMeterManifest.id}@${RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION}`,
    ].sort())
    expect(payload.components[
      `${phaserMeterManifest.id}@${RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION}`
    ]).toMatchObject({
      id: phaserMeterManifest.id,
      version: RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
      apiVersion: 4,
      scopes: ['scene'],
      renderMode: 'phaser',
    })
    const surface = payload.surfaces[0]
    expect(surface?.type).toBe('slide')
    if (!surface || surface.type !== 'slide') throw new Error('Published V2 lost its Slide surface')
    expect(surface.scenes).toHaveLength(5)
    expect(surface.scenes.flatMap(({ layerItems }) => layerItems)).toContainEqual(
      expect.objectContaining({
        kind: 'component',
        layerItemId: 'phaser_meter_component_instance',
        component: {
          packageId: phaserMeterManifest.id,
          version: RENDER_HOST_BENCHMARK_V9_PHASER_METER_VERSION,
        },
      }),
    )
    const runtimeModes = surface.scenes.flatMap(({ layerItems }) => layerItems).flatMap((item) =>
      item.kind === 'runtime' ? [[item.runtime.runtimeApiVersion, item.runtime.renderMode]] : [])
    expect(runtimeModes).toEqual([
        [2, 'phaser'],
        [2, 'dom'],
      ])
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).not.toContain('window.__H5_LESSON_PAYLOAD__=')
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/connect-src[^;]*(?:https?:|\*|'self')/i)
    expect(notice).toContain(`## Three.js ${declaredThreeVersion}`)
    expect(notice).toContain('render-host-benchmark-v2.html')
  })
})
