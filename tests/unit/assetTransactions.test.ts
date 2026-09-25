import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8 } from 'fflate'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import type {
  CourseProjectDocument,
  NativeLayerItem,
  RuntimeLayerItem,
  SlideSurfaceDocument,
} from '@/shared/courseProjectTypes'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import {
  createExternalComponentNode,
  createImageNode,
} from '@/core/tools/nativeNodeFactories'
import { assetBytesSha256 } from '@/renderer/project/assetManager'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { prepareHashedMediaBatch } from '@/renderer/project/v9AssetAdapter'
import { allocateCourseLayerOrder } from '@/renderer/course/globalLayerCommands'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import {
  connectCourseHost,
  courseContent,
  openCourseOnHost,
  redoSettled,
  settleCourse,
  undoSettled,
  type CourseHost,
} from '../helpers/triage-t2-course'

let host: CourseHost
let documentId: string

const SLIDE_FIXTURE_PATH = join(
  process.cwd(),
  'tests',
  'fixtures',
  'architecture-baseline',
  'slide-heavy.h5lesson',
)

function meta(
  id: string,
  kind: AssetMeta['kind'] = 'image',
  filename = `${id}.bin`,
): AssetMeta {
  return {
    id,
    filename,
    mimeType: kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png',
    kind,
    path: `assets/${filename}`,
    byteLength: 3,
    ...(kind === 'image' ? { width: 320, height: 180 } : {}),
  }
}

function firstSlideScene(project: CourseProjectDocument) {
  const surface = project.surfaces.find((candidate): candidate is SlideSurfaceDocument => (
    candidate.type === 'slide'
  ))
  const scene = surface?.scenes[0]
  if (!scene) throw new Error('expected Slide scene')
  return scene
}

function appendSceneLayer(
  project: CourseProjectDocument,
  node: Parameters<typeof sceneNodeToCourseLayerItem>[0],
) {
  const scene = firstSlideScene(project)
  scene.layerItems.push(sceneNodeToCourseLayerItem(
    node,
    allocateCourseLayerOrder(project, scene.layerItems.length + 1),
  ))
}

function runtimeLayer(
  layerItemId: string,
  order: number,
  assets: Record<string, { assetId: string }>,
  fallbackId: string,
): RuntimeLayerItem {
  return {
    layerItemId,
    label: 'Runtime',
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      source: "CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})",
      content: { values: {} },
      assets,
      staticFallback: { assetId: fallbackId, coverage: 'scene' },
    },
  }
}

async function loadSlideFixture(): Promise<void> {
  const archive = openCourseProjectArchive(
    new Uint8Array(readFileSync(SLIDE_FIXTURE_PATH)),
  )
  const connected = await openCourseOnHost(archive.project, {
    assetFiles: archive.assetFiles,
    componentPackages: componentPackagesFromArchive(archive.project, archive.componentFiles),
  })
  host = connected.host
  documentId = connected.documentId
  useEditorStore.getState().activateCourseLocation('slide-location-intro')
  useEditorStore.getState().setActivePresentationState(null)
  useEditorStore.getState().selectNode('slide-intro-hero')
}

function activeCourseProject(): CourseProjectDocument {
  const project = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!project) throw new Error('Expected a Course Project V9')
  return project
}

function introHeroAssetId(project = activeCourseProject()): string {
  const surface = project.surfaces.find((candidate) => candidate.id === 'slide-surface')
  if (!surface || surface.type !== 'slide') throw new Error('Missing Slide surface')
  const scene = surface.scenes.find((candidate) => candidate.id === 'slide-scene-intro')
  const item = scene?.layerItems.find((candidate) => (
    candidate.layerItemId === 'slide-intro-hero'
  ))
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'image') {
    throw new Error('Missing intro hero image')
  }
  return item.content.data.assetId
}

function nativeLayerItems(project: CourseProjectDocument): NativeLayerItem[] {
  return [
    ...project.globalLayerItems.map((entry) => entry.item),
    ...project.surfaces.flatMap((surface) => (
      surface.type === 'slide'
        ? [
            ...surface.surfaceLayerItems.map((entry) => entry.item),
            ...surface.scenes.flatMap((scene) => scene.layerItems),
          ]
        : []
    )),
  ].filter((item): item is NativeLayerItem => item.kind === 'native')
}

function nativeVideoLayer(project = activeCourseProject()): NativeLayerItem | undefined {
  return nativeLayerItems(project).find((item) => item.content.nativeType === 'video')
}

beforeEach(async () => {
  const connected = await connectCourseHost()
  host = connected.host
  documentId = connected.documentId
})

describe('hashed media batch preparation', () => {
  it('reuses existing content by captured hash and does not decode duplicates', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const hash = await assetBytesSha256(bytes)
    const existing = meta('hero', 'image', 'hero.png')
    let decoded = 0
    const prepared = await prepareHashedMediaBatch(
      [{ name: 'dup.png', bytes, sha256: hash }],
      'image',
      { hero: existing },
      { hero: bytes },
      async () => {
        decoded += 1
        throw new Error('duplicate should not decode')
      },
      () => 'decode failed',
    )
    expect(decoded).toBe(0)
    expect(prepared.duplicateCount).toBe(1)
    expect(prepared.additions).toEqual([])
    expect(prepared.placements).toEqual([{ meta: existing, bytes }])
    expect(prepared.decodeFailures).toEqual([])
  })
})

describe('single asset history transactions', () => {
  it('undoes and redoes video import, metadata, bytes, and node together', async () => {
    const video = meta('video', 'video', 'video.mp4')
    useEditorStore.getState().addVideoNode(video, new Uint8Array([1, 2, 3]))
    await settleCourse()
    expect(nativeVideoLayer()?.content).toMatchObject({
      nativeType: 'video', data: { assetId: 'video' },
    })
    expect(activeCourseProject().assets.video).toEqual(video)
    expect([...selectMediaAssetFiles(useEditorStore.getState()).video!]).toEqual([1, 2, 3])

    await undoSettled(host, documentId)
    expect(nativeVideoLayer()).toBeUndefined()
    expect(activeCourseProject().assets.video).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState()).video).toBeUndefined()
    await redoSettled(host, documentId)
    expect(nativeVideoLayer()?.content).toMatchObject({
      nativeType: 'video', data: { assetId: 'video' },
    })
    expect(activeCourseProject().assets.video).toEqual(video)
    expect([...selectMediaAssetFiles(useEditorStore.getState()).video!]).toEqual([1, 2, 3])
  })

  it('undoes and redoes target-based image replacement using a conflict-free asset ID', async () => {
    await loadSlideFixture()
    const originalProject = structuredClone(activeCourseProject())
    const originalAssetId = introHeroAssetId(originalProject)
    const originalBytes = selectMediaAssetFiles(useEditorStore.getState())[originalAssetId]
    if (!originalBytes) throw new Error('Missing original hero bytes')
    const replacement = {
      ...meta('image-replacement', 'image', 'new.png'),
      byteLength: 4,
    }
    const target = useEditorStore.getState().captureImageReplacementTarget()
    if (!target) throw new Error('Expected a captured image target')
    const result = useEditorStore.getState().replaceImageAssetAtTarget(
      target,
      replacement,
      new Uint8Array([4, 5, 6, 7]),
    )
    expect(result).toMatchObject({ ok: true, status: 'replaced' })
    await settleCourse()
    expect(introHeroAssetId()).toBe(replacement.id)
    expect(activeCourseProject().assets[originalAssetId])
      .toEqual(originalProject.assets[originalAssetId])
    expect(activeCourseProject().assets[replacement.id]).toEqual(replacement)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect([...selectMediaAssetFiles(useEditorStore.getState())[replacement.id]!])
      .toEqual([4, 5, 6, 7])

    await undoSettled(host, documentId)
    // DocumentSession revision only increases; compare authored content without that stamp.
    expect(courseContent(activeCourseProject())).toEqual(courseContent(originalProject))
    expect(introHeroAssetId()).toBe(originalAssetId)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect(activeCourseProject().assets[replacement.id]).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacement.id]).toBeUndefined()
    await redoSettled(host, documentId)
    expect(introHeroAssetId()).toBe(replacement.id)
    expect(activeCourseProject().assets[originalAssetId])
      .toEqual(originalProject.assets[originalAssetId])
    expect(activeCourseProject().assets[replacement.id]).toEqual(replacement)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect([...selectMediaAssetFiles(useEditorStore.getState())[replacement.id]!])
      .toEqual([4, 5, 6, 7])
  })

  it('undoes and redoes a sound definition with its asset bytes', async () => {
    const audio = meta('audio', 'audio', 'voice.mp3')
    const soundId = useEditorStore.getState().importSound(
      audio,
      new Uint8Array([7, 8, 9]),
    )
    await settleCourse()
    expect(activeCourseProject().media.audio.sounds[soundId]).toBeDefined()
    expect(activeCourseProject().assets.audio).toEqual(audio)
    expect([...selectMediaAssetFiles(useEditorStore.getState()).audio!]).toEqual([7, 8, 9])
    await undoSettled(host, documentId)
    expect(activeCourseProject().media.audio.sounds[soundId]).toBeUndefined()
    expect(activeCourseProject().assets.audio).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState()).audio).toBeUndefined()
    await redoSettled(host, documentId)
    expect(activeCourseProject().media.audio.sounds[soundId]).toBeDefined()
    expect(activeCourseProject().assets.audio).toEqual(audio)
    expect([...selectMediaAssetFiles(useEditorStore.getState()).audio!]).toEqual([7, 8, 9])
  })
})

describe('asset deletion safety', () => {
  it('blocks named-state background and node image references with locations', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const scene = firstSlideScene(project)
    const state = scene.presentation!.states[0]!
    const background = meta('state-bg')
    const override = meta('state-node')
    project.assets[background.id] = background
    project.assets[override.id] = override
    state.backgroundAssetId = background.id
    const node = createImageNode('state-node')
    appendSceneLayer(project, node)

    await openCourseOnHost(project, {
      assetFiles: {
        'state-bg': new Uint8Array([1, 0, 0]),
        'state-node': new Uint8Array([2, 0, 0]),
      },
    })

    expect(useEditorStore.getState().deleteAsset('state-bg')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('backgroundAssetId')
    expect(useEditorStore.getState().deleteAsset('state-node')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('assetId')
  })

  it('blocks runtime fallback/source and declared component fallback references', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    ;['fallback', 'source', 'component'].forEach((id) => {
      project.assets[id] = meta(id)
    })
    const scene = firstSlideScene(project)
    scene.layerItems.push(runtimeLayer(
      'runtime-asset-refs',
      allocateCourseLayerOrder(project, 1),
      { source: { assetId: 'source' } },
      'fallback',
    ))
    const componentNode = createExternalComponentNode({
      component: { packageId: 'com.test.asset', version: '4.0.0' },
      props: { nested: { image: 'component' } },
    })
    appendSceneLayer(project, componentNode)
    const componentItem = scene.layerItems.find((item) => item.kind === 'component')
    if (!componentItem || componentItem.kind !== 'component') {
      throw new Error('expected component layer')
    }
    componentItem.staticFallbackAssetId = 'component'
    // The document host only ingests packages with real executable bytes.
    const packageData = parseComponentPackageFiles({
      'manifest.json': strToU8(JSON.stringify({
        schemaVersion: 4, runtimeApiVersion: 4,
        id: 'com.test.asset', name: 'Asset component', version: '4.0.0',
        entry: 'runtime.js', defaultSize: { width: 100, height: 100 },
        minSize: { width: 16, height: 16 }, preserveAspectRatio: false,
        assets: {}, defaultProps: {}, supportedScopes: ['scene'],
        renderMode: 'dom',
      })),
      'runtime.js': strToU8(
        'CoursewareComponent.define({create(){return {destroy(){}}}})',
      ),
    })
    project.componentPackages['com.test.asset'] = {
      packageId: 'com.test.asset', version: '4.0.0', name: 'Asset component',
      manifestPath: 'components/com.test.asset@4.0.0/manifest.json',
      runtimePath: 'components/com.test.asset@4.0.0/runtime.js',
      contentSha256: packageData.contentSha256!,
    }
    await openCourseOnHost(project, {
      assetFiles: {
        fallback: new Uint8Array([1, 0, 0]),
        source: new Uint8Array([2, 0, 0]),
        component: new Uint8Array([3, 0, 0]),
      },
      componentPackages: { 'com.test.asset': packageData },
    })

    expect(useEditorStore.getState().deleteAsset('fallback')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('staticFallback')
    expect(useEditorStore.getState().deleteAsset('source')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('source')
    expect(useEditorStore.getState().deleteAsset('component')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('staticFallbackAssetId')
  })

  it('fails closed at load when a component declares a fallback without executable files', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    project.assets.possible = meta('possible')
    const componentNode = createExternalComponentNode({
      component: { packageId: 'com.test.missing', version: '4.0.0' },
    })
    appendSceneLayer(project, componentNode)
    const componentItem = firstSlideScene(project).layerItems.find((item) => item.kind === 'component')
    if (!componentItem || componentItem.kind !== 'component') {
      throw new Error('expected component layer')
    }
    componentItem.staticFallbackAssetId = 'possible'
    project.componentPackages['com.test.missing'] = {
      packageId: 'com.test.missing',
      version: '4.0.0',
      name: 'Missing component',
      manifestPath: 'components/manifest.json',
      runtimePath: 'components/runtime.js',
      contentSha256: '0'.repeat(64),
    }
    // The document host fails closed at load: a component without executable
    // bytes can never become the active document, so its declared fallback can
    // never leave the referenced asset unprotected.
    useEditorStore.getState().loadCourseProject(project, null, {
      possible: new Uint8Array([1, 0, 0]),
    })
    await vi.waitFor(() => {
      if (!useEditorStore.getState().errorMessage?.includes('com.test.missing')) {
        throw new Error('waiting for rejection')
      }
    })
    expect(selectActiveCourseProjectDocument(useEditorStore.getState())?.id).not.toBe(project.id)
  })
})
