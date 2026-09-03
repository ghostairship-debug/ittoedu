import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { planCourseMediaLibraryImport } from '@/renderer/media/courseMediaLibraryImport'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { AssetMeta } from '@/shared/contracts/media-v1/types'
import type {
  ComponentLayerItem,
  CourseProjectDocument,
  NativeLayerItem,
  RuntimeLayerItem,
  SlideSceneDocument,
} from '@/shared/courseProjectTypes'
import { listCourseAssetReferences } from '@/renderer/project/v9AssetAdapter'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'

function asset(id: string, kind: AssetMeta['kind'] = 'image'): AssetMeta {
  return {
    id,
    filename: `${id}.${kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'png'}`,
    mimeType: kind === 'audio' ? 'audio/mpeg' : kind === 'video' ? 'video/mp4' : 'image/png',
    kind,
    path: `assets/${id}`,
    byteLength: 10,
  }
}

function firstSlideScene(project: CourseProjectDocument): SlideSceneDocument {
  const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
  const scene = surface?.type === 'slide' ? surface.scenes[0] : undefined
  if (!scene) throw new Error('Expected a V9 Slide scene')
  return scene
}

function layerBase(layerItemId: string, order: number) {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute' as const, x: 40, y: 40, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto' as const,
    playbackInitialVisibility: 'inherit' as const,
  }
}

function imageLayer(layerItemId: string, assetId: string, order = 0): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order),
    kind: 'native',
    content: {
      nativeType: 'image',
      data: {
        assetId,
        preserveAspectRatio: true,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropX: 0.5,
        cropY: 0.5,
        flipX: false,
        flipY: false,
        cornerRadius: 0,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function videoLayer(
  layerItemId: string,
  assetId: string,
  posterAssetId: string,
): NativeLayerItem {
  return {
    ...layerBase(layerItemId, 5),
    kind: 'native',
    content: {
      nativeType: 'video',
      data: {
        assetId,
        fit: 'contain',
        autoplay: false,
        loop: false,
        muted: false,
        volume: 1,
        playbackRate: 1,
        showControls: true,
        clickToToggle: true,
        startTime: 0,
        endTime: null,
        poster: { mode: 'video-frame', time: 0, assetId: posterAssetId },
        backgroundAudioMode: 'none',
      },
    },
  }
}

function runtimeLayer(layerItemId: string, contentId: string, sourceId: string): RuntimeLayerItem {
  return {
    ...layerBase(layerItemId, 10),
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: false,
      renderMode: 'dom',
      source: `CoursewareRuntime.define({create(ctx){ctx.projectAssetUrl('${sourceId}')}})`,
      content: { values: { nested: contentId } },
      assets: {},
    },
  }
}

function componentLayer(packageId: string): ComponentLayerItem {
  return {
    ...layerBase('component-layer', 20),
    kind: 'component',
    component: { packageId, version: '4.0.0' },
    props: { cover: 'component-base' },
  }
}

function componentPackage(packageId: string): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: packageId,
      name: 'Asset component',
      version: '4.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 80, height: 45 },
      preserveAspectRatio: false,
      supportedScopes: ['scene'],
      renderMode: 'dom',
      assets: {},
      defaultProps: { defaultCover: 'component-default' },
      editor: {
        properties: [
          { key: 'cover', label: 'Cover', type: 'image' },
          { key: 'defaultCover', label: 'Default cover', type: 'image' },
        ],
      },
    },
    runtimeSource: "CoursewareComponent.define({create(ctx){ctx.projectAssetUrl('component-source')}})",
    files: {},
  }
}

function addAssets(project: CourseProjectDocument, ...ids: string[]): void {
  ids.forEach((id) => { project.assets[id] = asset(id) })
}

function loadProject(
  project: CourseProjectDocument,
  componentPackages: Record<string, ComponentPackageData> = {},
): void {
  const files = Object.fromEntries(Object.values(project.assets).map((meta) => [
    meta.id,
    new Uint8Array(meta.byteLength),
  ]))
  useEditorStore.getState().loadCourseProject(project, null, files, componentPackages)
}

describe('project asset reference graph', () => {
  it('keeps V9 deletion aligned with referenced assets', () => {
    const referenced = asset('referenced')
    const unused = asset('unused')
    const store = useEditorStore.getState()
    store.createNewProject()
    store.addImageNode(referenced, new Uint8Array(referenced.byteLength))
    store.importAsset(unused, new Uint8Array(unused.byteLength))

    const project = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!project) throw new Error('Expected a live V9 project')
    expect(listCourseAssetReferences(project, referenced.id)).toEqual([
      expect.objectContaining({ kind: 'native-image', assetId: referenced.id }),
    ])
    expect(listCourseAssetReferences(project, unused.id)).toEqual([])

    const deleteBlocked = new Set(['referenced', 'unused'].filter((assetId) => (
      !useEditorStore.getState().deleteAsset(assetId)
    )))
    expect(deleteBlocked).toEqual(new Set(['referenced']))
  })

  it('protects assets materialized only by a named-state native override', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    addAssets(project, 'base-image', 'state-image')
    const scene = firstSlideScene(project)
    const image = imageLayer('stateful-image', 'base-image')
    scene.layerItems.push(image)
    scene.presentation!.states[0]!.layerItemOverrides[image.layerItemId] = {
      nativeData: { assetId: 'state-image' },
    }
    loadProject(project)

    expect(useEditorStore.getState().deleteAsset('state-image')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('nativeData.assetId')
  })

  it('protects a persisted video poster asset regardless of poster capture mode', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    addAssets(project, 'video-asset', 'video-poster')
    firstSlideScene(project).layerItems.push(videoLayer(
      'video-with-persisted-poster',
      'video-asset',
      'video-poster',
    ))
    loadProject(project)

    expect(listCourseAssetReferences(project, 'video-poster')).toContainEqual(
      expect.objectContaining({
        kind: 'video-poster',
        path: expect.arrayContaining(['poster', 'assetId']),
      }),
    )
    expect(useEditorStore.getState().deleteAsset('video-poster')).toBe(false)
  })

  it('protects known ids in disabled Runtime content and quoted source', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    addAssets(project, 'runtime-content', 'runtime-source')
    firstSlideScene(project).layerItems.push(runtimeLayer(
      'runtime-layer',
      'runtime-content',
      'runtime-source',
    ))
    loadProject(project)

    expect(useEditorStore.getState().deleteAsset('runtime-content')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('content.values')
    expect(useEditorStore.getState().deleteAsset('runtime-source')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('source')
  })

  it('protects component props, defaults, state overrides, and runtime source', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const packageId = 'com.test.asset-closure'
    addAssets(
      project,
      'component-base',
      'component-default',
      'component-state',
      'component-source',
    )
    project.componentPackages[packageId] = {
      packageId,
      version: '4.0.0',
      name: 'Asset component',
      manifestPath: `components/${packageId}/manifest.json`,
      runtimePath: `components/${packageId}/runtime.js`,
      contentSha256: '0'.repeat(64),
    }
    const scene = firstSlideScene(project)
    const component = componentLayer(packageId)
    scene.layerItems.push(component)
    scene.presentation!.states[0]!.layerItemOverrides[component.layerItemId] = {
      componentProps: { cover: 'component-state' },
    }
    const packages = { [packageId]: componentPackage(packageId) }
    expect(listCourseAssetReferences(project, 'component-state', {
      componentPackages: packages,
    })).toContainEqual(expect.objectContaining({
      kind: 'component-prop',
      path: expect.arrayContaining(['componentProps', 'cover']),
    }))
    loadProject(project, packages)

    for (const id of [
      'component-base',
      'component-default',
      'component-state',
      'component-source',
    ]) {
      expect(useEditorStore.getState().deleteAsset(id), id).toBe(false)
    }
  })

  it('fails closed when a V9 component lacks matching executable context', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const packageId = 'com.test.missing-context'
    addAssets(project, 'possibly-referenced')
    project.componentPackages[packageId] = {
      packageId,
      version: '4.0.0',
      name: 'Missing context',
      manifestPath: `components/${packageId}/manifest.json`,
      runtimePath: `components/${packageId}/runtime.js`,
      contentSha256: '0'.repeat(64),
    }
    const component = componentLayer(packageId)
    component.props = {}
    firstSlideScene(project).layerItems.push(component)
    loadProject(project)

    expect(useEditorStore.getState().deleteAsset('possibly-referenced')).toBe(false)
    expect(useEditorStore.getState().errorMessage).toContain('component')
  })

  it('preserves existing V9 remote delivery metadata while importing local media', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    project.assets.remote = {
      ...asset('remote'),
      remote: { url: 'https://cdn.example.test/remote.png' },
    }
    const imported = asset('imported')
    const result = planCourseMediaLibraryImport({
      project,
      sidecar: { files: { remote: new Uint8Array(project.assets.remote.byteLength) } },
      items: [{ meta: imported, bytes: new Uint8Array(imported.byteLength) }],
      projectId: project.id,
      baseRevision: project.revision,
      now: '2026-09-03T00:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    if (!result.ok || result.status !== 'planned') {
      throw new Error('Expected a media import transaction plan')
    }
    expect(result.plan.nextDocument.assets.remote?.remote).toEqual({
      url: 'https://cdn.example.test/remote.png',
    })
    expect(project.assets.remote.remote).toEqual({
      url: 'https://cdn.example.test/remote.png',
    })
  })
})
