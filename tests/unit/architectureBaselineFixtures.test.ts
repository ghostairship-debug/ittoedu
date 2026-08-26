import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  ARCHITECTURE_BASELINE_FIXTURE_IDS,
  ARCHITECTURE_BASELINE_FIXTURE_MTIME,
  ARCHITECTURE_BASELINE_FIXTURE_SPECS,
  ARCHITECTURE_BASELINE_OUTPUT_DIRECTORY,
  buildArchitectureBaselineFixtureOutputs,
  type ArchitectureBaselineFixtureId,
} from '../../scripts/build-architecture-baseline-fixtures'
import { componentContentSha256 } from '../../src/shared/componentContentIntegrity'
import { openCourseProjectArchive } from '../../src/renderer/project/courseProjectArchive'
import type { CourseProjectDocument, FlowBlock } from '../../src/shared/courseProjectTypes'
import { validateCourseProjectArchiveBytes } from '../../scripts/validate-project'

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
      // `contentSha256` stays the packaging-independent content digest.
      const packageBytes = zipSync({ ...packageFiles }, {
        level: 6,
        mtime: ARCHITECTURE_BASELINE_FIXTURE_MTIME,
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
