import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AssetMeta } from '@/shared/projectTypes'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import {
  createExternalComponentNode,
  createImageNode,
  createProject,
} from '@/renderer/project/createProject'
import { openCourseProjectArchive } from '@/renderer/project/courseProjectArchive'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'

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

function loadSlideFixture(): void {
  const archive = openCourseProjectArchive(
    new Uint8Array(readFileSync(SLIDE_FIXTURE_PATH)),
  )
  useEditorStore.getState().loadCourseProject(
    archive.project,
    null,
    archive.assetFiles,
    componentPackagesFromArchive(archive.project, archive.componentFiles),
  )
  useEditorStore.getState().activateCourseLocation('slide-location-intro')
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

beforeEach(() => useEditorStore.getState().createNewProject())

describe('single asset history transactions', () => {
  it('undoes and redoes video import, metadata, bytes, and node together', () => {
    const video = meta('video', 'video', 'video.mp4')
    useEditorStore.getState().addVideoNode(video, new Uint8Array([1, 2, 3]))
    expect(useEditorStore.getState().project.scenes[0]!.nodes[0]).toMatchObject({
      type: 'video', assetId: 'video',
    })

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.scenes[0]!.nodes).toHaveLength(0)
    expect(useEditorStore.getState().project.assets.video).toBeUndefined()
    expect(useEditorStore.getState().assetFiles.video).toBeUndefined()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().project.assets.video).toEqual(video)
    expect([...useEditorStore.getState().assetFiles.video!]).toEqual([1, 2, 3])
  })

  it('undoes and redoes target-based image replacement using a conflict-free asset ID', () => {
    loadSlideFixture()
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
    expect(introHeroAssetId()).toBe(replacement.id)
    expect(activeCourseProject().assets[originalAssetId])
      .toEqual(originalProject.assets[originalAssetId])
    expect(activeCourseProject().assets[replacement.id]).toEqual(replacement)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect([...selectMediaAssetFiles(useEditorStore.getState())[replacement.id]!])
      .toEqual([4, 5, 6, 7])

    useEditorStore.getState().undo()
    expect(activeCourseProject()).toEqual(originalProject)
    expect(introHeroAssetId()).toBe(originalAssetId)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect(activeCourseProject().assets[replacement.id]).toBeUndefined()
    expect(selectMediaAssetFiles(useEditorStore.getState())[replacement.id]).toBeUndefined()
    useEditorStore.getState().redo()
    expect(introHeroAssetId()).toBe(replacement.id)
    expect(activeCourseProject().assets[originalAssetId])
      .toEqual(originalProject.assets[originalAssetId])
    expect(activeCourseProject().assets[replacement.id]).toEqual(replacement)
    expect(selectMediaAssetFiles(useEditorStore.getState())[originalAssetId])
      .toEqual(originalBytes)
    expect([...selectMediaAssetFiles(useEditorStore.getState())[replacement.id]!])
      .toEqual([4, 5, 6, 7])
  })

  it('undoes and redoes a sound definition with its asset bytes', () => {
    const audio = meta('audio', 'audio', 'voice.mp3')
    const soundId = useEditorStore.getState().importSound(
      audio,
      new Uint8Array([7, 8, 9]),
    )
    expect(useEditorStore.getState().project.media.audio.sounds[soundId]).toBeDefined()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project.media.audio.sounds[soundId]).toBeUndefined()
    expect(useEditorStore.getState().project.assets.audio).toBeUndefined()
    expect(useEditorStore.getState().assetFiles.audio).toBeUndefined()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().project.media.audio.sounds[soundId]).toBeDefined()
    expect([...useEditorStore.getState().assetFiles.audio!]).toEqual([7, 8, 9])
  })
})

describe('asset deletion safety', () => {
  it('blocks named-state background and node override references with locations', () => {
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const state = project.scenes[0]!.presentation!.states[0]!
    const background = meta('state-bg')
    const override = meta('state-node')
    project.assets[background.id] = background
    project.assets[override.id] = override
    state.backgroundAssetId = background.id
    const node = createImageNode('base')
    project.assets.base = meta('base')
    project.scenes[0]!.nodes.push(node)
    state.nodeOverrides[node.id] = { assetId: override.id }
    useEditorStore.getState().loadProject(project, null, {
      'state-bg': new Uint8Array([1]),
      'state-node': new Uint8Array([2]),
      base: new Uint8Array([3]),
    })

    expect(useEditorStore.getState().deleteAsset('state-bg')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain(`状态 ${state.id}`)
    expect(useEditorStore.getState().deleteAsset('state-node')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain(`节点 ${node.id}`)
  })

  it('blocks runtime fallback/source and nested component prop references', () => {
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    ;['fallback', 'source', 'component'].forEach((id) => {
      project.assets[id] = meta(id)
    })
    project.scenes[0]!.runtime = {
      runtimeApiVersion: 2, enabled: true, renderMode: 'dom', assets: {},
      content: { values: {} },
      staticFallback: { assetId: 'fallback', coverage: 'runtime-layer', layer: 'overlay' },
      source: `ctx.projectAssetUrl('source')`,
    }
    const componentNode = createExternalComponentNode({
      component: { packageId: 'com.test.asset', version: '4.0.0' },
      props: { nested: { image: 'component' } },
    })
    project.scenes[0]!.nodes.push(componentNode)
    project.componentPackages['com.test.asset'] = {
      packageId: 'com.test.asset', version: '4.0.0', name: 'Asset component',
      manifestPath: 'components/manifest.json', runtimePath: 'components/runtime.js',
      contentSha256: '0'.repeat(64),
    }
    const packageData = {
      manifest: {
        schemaVersion: 4 as const, runtimeApiVersion: 4 as const,
        id: 'com.test.asset', name: 'Asset component', version: '4.0.0',
        entry: 'runtime.js', defaultSize: { width: 100, height: 100 },
        minSize: { width: 10, height: 10 }, preserveAspectRatio: false,
        assets: {}, defaultProps: {}, supportedScopes: ['scene' as const],
        renderMode: 'dom' as const,
      },
      runtimeSource: '', files: {},
    }
    useEditorStore.getState().loadProject(project, null, {
      fallback: new Uint8Array([1]), source: new Uint8Array([2]), component: new Uint8Array([3]),
    }, { 'com.test.asset': packageData })

    expect(useEditorStore.getState().deleteAsset('fallback')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('staticFallback')
    expect(useEditorStore.getState().deleteAsset('source')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('source')
    expect(useEditorStore.getState().deleteAsset('component')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain(`组件 com.test.asset`)
  })

  it('conservatively blocks deletion when component executable context is absent', () => {
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    project.assets.possible = meta('possible')
    project.scenes[0]!.nodes.push(createExternalComponentNode({
      component: { packageId: 'com.test.missing', version: '4.0.0' },
    }))
    project.componentPackages['com.test.missing'] = {
      packageId: 'com.test.missing',
      version: '4.0.0',
      name: 'Missing component',
      manifestPath: 'components/manifest.json',
      runtimePath: 'components/runtime.js',
      contentSha256: '0'.repeat(64),
    }
    useEditorStore.getState().loadProject(project, null, {
      possible: new Uint8Array([1]),
    })

    expect(useEditorStore.getState().deleteAsset('possible')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('组件 com.test.missing')
  })
})
