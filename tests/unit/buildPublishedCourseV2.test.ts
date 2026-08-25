import { describe, expect, it } from 'vitest'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
  ScopedLayerItem,
} from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import type { AssetMeta } from '@/shared/projectTypes'
import { createProject } from '@/renderer/project/createProject'
import {
  buildPublishedCourseV2Payload,
  collectPublishedCourseAssetIds,
  collectPublishedCourseComponentKeys,
  PublishedCourseSourceError,
  type CoursePublishSources,
  type PublishedCourseSourceIssueCode,
} from '@/renderer/export/course/buildPublishedCourse'
import { collectCoursePackageExportPreflight } from '@/renderer/export/course/buildCoursePackages'

const NOW = '2026-08-17T00:00:00.000Z'
const ASSET_BYTES = new Uint8Array([1, 2, 3])
const PLAYER_BUNDLE = 'window.__COURSE_PLAYER_PLACEHOLDER__=true;'

function asset(id: string, kind: AssetMeta['kind'] = 'image'): AssetMeta {
  const mimeType = kind === 'audio' ? 'audio/mpeg' : kind === 'video' ? 'video/mp4' : 'image/png'
  return {
    id,
    filename: `${id}.${kind === 'audio' ? 'mp3' : kind === 'video' ? 'mp4' : 'png'}`,
    mimeType,
    kind,
    path: `assets/${id}`,
    byteLength: ASSET_BYTES.byteLength,
  }
}

function textStyle() {
  return {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 24,
    color: '#172033',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left' as const,
    verticalAlign: 'top' as const,
    writingMode: 'horizontal' as const,
    lineSpacing: 1.3,
    letterSpacing: 0,
    padding: 4,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function nativeText(layerItemId: string, order: number, text: string): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function nativeImage(layerItemId: string, order: number, assetId: string): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 80, y: 160, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
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

function scoped(item: LayerItem, locationIds: string[] = []): ScopedLayerItem {
  return {
    item,
    visibility: locationIds.length === 0
      ? { mode: 'all', locationIds: [] }
      : { mode: 'include', locationIds },
  }
}

function componentPackage(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    id: 'component.quiz',
    name: 'Quiz',
    version: '4.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 400, height: 240 },
    minSize: { width: 200, height: 120 },
    preserveAspectRatio: false,
    assets: { icon: 'assets/icon.png' },
    defaultProps: { cover: 'default-cover', prompt: 'default prompt' },
    supportedScopes: ['scene'],
    renderMode: 'dom',
    editor: {
      properties: [{ key: 'cover', label: 'Cover', type: 'image' }],
    },
  }
  const runtimeSource = `window.CoursewareComponent.define({id:'component.quiz',runtimeApiVersion:4,create(ctx){return {destroy(){}}}})`
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
    'assets/icon.png': new Uint8Array([9, 8, 7]),
  }
  return { manifest, runtimeSource, files, contentSha256: componentContentSha256(files) }
}

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: 9,
    id: 'published-v2-course',
    revision: 3,
    title: '最小发布课件',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [{ key: 'ready', valueType: 'boolean', defaultValue: false }],
    navigationGuards: [{
      id: 'guard-spatial',
      effect: 'block',
      toLocationIds: ['location-spatial'],
      match: 'all',
      conditions: [{ type: 'compare', key: 'ready', operator: 'eq', value: false }],
      message: '未就绪',
    }],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function mixedSources(): CoursePublishSources {
  const quiz = componentPackage()
  const project: CourseProjectDocument = {
    ...courseShell(),
    assets: {
      'slide-image': asset('slide-image'),
      'flow-image': asset('flow-image'),
      'runtime-fallback': asset('runtime-fallback'),
      'component-fallback': asset('component-fallback'),
      'instance-cover': asset('instance-cover'),
      'state-cover': asset('state-cover'),
      unused: asset('unused'),
    },
    componentPackages: {
      'component.quiz': {
        packageId: 'component.quiz',
        version: '4.0.0',
        name: 'Quiz',
        manifestPath: 'components/component.quiz/manifest.json',
        runtimePath: 'components/component.quiz/runtime.js',
        contentSha256: quiz.contentSha256!,
      },
    },
    globalLayerItems: [scoped(nativeText('global-banner', 50, '全局条'))],
    locations: [
      {
        id: 'location-slide',
        label: '幻灯',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
      {
        id: 'location-slide-state',
        label: '换图',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
        stateId: 'slide-state-cover',
      },
      {
        id: 'location-flow',
        label: '长文标题',
        kind: 'flow-block',
        surfaceId: 'surface-flow',
        blockId: 'flow-heading',
      },
      {
        id: 'location-spatial',
        label: '空间总览',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'spatial-home',
      },
    ],
    startLocationId: 'location-slide',
    surfaces: [
      {
        id: 'surface-slide',
        title: '演示',
        type: 'slide',
        canvas: { width: 1280, height: 720 },
        surfaceLayerItems: [scoped(nativeText('slide-shared', 10, '表面共享'), ['location-slide'])],
        scenes: [{
          id: 'scene-1',
          name: '场景 1',
          backgroundColor: '#ffffff',
          layerItems: [
            nativeText('slide-title', 1, '可编辑标题'),
            nativeImage('slide-photo', 2, 'slide-image'),
            {
              layerItemId: 'slide-component',
              label: 'Slide quiz',
              frame: { mode: 'absolute', x: 700, y: 120, width: 400, height: 240 },
              order: 3,
              visible: true,
              locked: false,
              rotation: 0,
              opacity: 1,
              hitPolicy: 'auto',
              playbackInitialVisibility: 'inherit',
              kind: 'component',
              component: { packageId: 'component.quiz', version: '4.0.0' },
              props: { prompt: '幻灯片题', cover: 'instance-cover' },
              staticFallbackAssetId: 'component-fallback',
            },
            {
              layerItemId: 'slide-runtime',
              label: 'Runtime',
              frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
              order: 4,
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
                source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}})',
                content: { values: { label: 'Runtime' } },
                assets: {},
                staticFallback: { assetId: 'runtime-fallback', coverage: 'scene' },
              },
            },
          ],
          presentation: {
            initialStateId: 'slide-base',
            states: [
              { id: 'slide-base', name: '基础', layerItemOverrides: {} },
              {
                id: 'slide-state-cover',
                name: '换图',
                layerItemOverrides: {
                  'slide-component': { componentProps: { cover: 'state-cover' } },
                },
              },
            ],
          },
          interactions: [],
        }],
      },
      {
        id: 'surface-flow',
        title: '讲义',
        type: 'flow',
        surfaceLayerItems: [],
        layout: { readingWidth: 760, wideContentWidth: 1120 },
        blocks: [
          {
            id: 'flow-heading',
            type: 'heading',
            level: 1,
            text: '长文标题',
            runs: [{ start: 0, end: 4, style: { bold: true } }],
          },
          {
            id: 'flow-section',
            type: 'section',
            title: '插图',
            collapsedByDefault: false,
            blocks: [{
              id: 'flow-media',
              type: 'media',
              assetId: 'flow-image',
              mediaKind: 'image',
              altText: '图像',
              layout: 'content-width',
            }],
          },
          {
            id: 'flow-component',
            type: 'component',
            component: { packageId: 'component.quiz', version: '4.0.0' },
            props: { prompt: '本题', cover: 'instance-cover' },
            staticFallbackAssetId: 'component-fallback',
          },
        ],
      },
      {
        id: 'surface-spatial',
        title: '空间',
        type: 'spatial-2d',
        surfaceLayerItems: [],
        world: {
          bounds: { mode: 'finite', x: -500, y: -400, width: 1000, height: 800 },
          layerItems: [
            nativeText('spatial-a', 20, '甲'),
            nativeText('spatial-b', 21, '乙'),
          ],
          paths: [{
            id: 'path-1',
            name: '探索路线',
            layerItemIds: ['spatial-a', 'spatial-b'],
            style: { color: '#112233', width: 3, dash: 'dashed' },
          }],
          relations: [{
            id: 'relation-1',
            sourceLayerItemId: 'spatial-a',
            targetLayerItemId: 'spatial-b',
            label: '从甲到乙',
            kind: 'arrow',
          }],
        },
        camera: {
          home: { x: 0, y: 0, zoom: 1 },
          frames: [{ id: 'spatial-home', name: 'Home', x: 0, y: 0, zoom: 1 }],
        },
        semanticZoom: [],
      },
    ],
    mixedPrintPlan: {
      pageSize: 'surface-native',
      orientation: 'auto',
      entries: [
        { id: 'print-slide', kind: 'slide-scenes', surfaceId: 'surface-slide', sceneIds: ['scene-1'] },
        { id: 'print-flow', kind: 'flow-document', surfaceId: 'surface-flow' },
        {
          id: 'print-spatial',
          kind: 'spatial-frames',
          surfaceId: 'surface-spatial',
          cameraFrameIds: ['spatial-home'],
        },
      ],
    },
  }
  courseProjectDocumentSchema.parse(project)
  return {
    project,
    assetFiles: Object.fromEntries(
      Object.keys(project.assets).map((id) => [id, ASSET_BYTES]),
    ),
    components: { 'component.quiz': quiz },
  }
}

interface MutableCoursePublishSources {
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
  components: Record<string, ComponentPackageData>
}

function mutableMixedSources(): MutableCoursePublishSources {
  const source = mixedSources()
  const assetFiles: Record<string, Uint8Array> = {}
  const components: Record<string, ComponentPackageData> = {}
  for (const [key, bytes] of Object.entries(source.assetFiles)) {
    assetFiles[key] = Uint8Array.from(bytes)
  }
  for (const [key, component] of Object.entries(source.components)) {
    const files: Record<string, Uint8Array> = {}
    for (const [path, bytes] of Object.entries(component.files)) {
      files[path] = Uint8Array.from(bytes)
    }
    components[key] = {
      ...component,
      manifest: structuredClone(component.manifest),
      files,
    }
  }
  return {
    project: structuredClone(source.project),
    assetFiles,
    components,
  }
}

describe('Published Course V2 producer', () => {
  it('builds V2 from an in-memory V9 project and keeps ownership, locations and asset closure', () => {
    const sources = mixedSources()
    expect([...collectPublishedCourseAssetIds(sources)].sort()).toEqual([
      'component-fallback',
      'flow-image',
      'instance-cover',
      'runtime-fallback',
      'slide-image',
      'state-cover',
    ])
    expect([...collectPublishedCourseComponentKeys(sources.project)]).toEqual([
      'component.quiz@4.0.0',
    ])

    const published = buildPublishedCourseV2Payload(sources)
    expect(publishedCourseV2Schema.parse(published)).toEqual(published)
    expect(published.format).toBe('h5course-published')
    expect(published.formatVersion).toBe(2)
    expect(published.sourceSchemaVersion).toBe(9)
    expect(published.courseId).toBe(sources.project.id)
    expect(published.locations.map((location) => location.id)).toEqual([
      'location-slide',
      'location-slide-state',
      'location-flow',
      'location-spatial',
    ])
    expect(published.startLocationId).toBe('location-slide')
    expect(published.courseState).toEqual(sources.project.courseState)
    expect(published.navigationGuards).toEqual(sources.project.navigationGuards)
    expect(published.globalLayerItems.map((entry) => entry.item.layerItemId)).toEqual(['global-banner'])
    expect(published.surfaces.map((surface) => surface.type)).toEqual(['slide', 'flow', 'spatial-2d'])

    const slide = published.surfaces[0]
    if (slide?.type !== 'slide') throw new Error('expected slide surface')
    expect(slide.surfaceLayerItems[0]?.item.layerItemId).toBe('slide-shared')
    expect(slide.surfaceLayerItems[0]?.visibility).toEqual({
      mode: 'include',
      locationIds: ['location-slide'],
    })
    expect(slide.scenes[0]?.layerItems.map((item) => item.layerItemId)).toEqual([
      'slide-title',
      'slide-photo',
      'slide-component',
      'slide-runtime',
    ])
    expect(slide.scenes[0]?.presentation?.states.map((state) => state.id)).toEqual([
      'slide-base',
      'slide-state-cover',
    ])
    expect(Object.keys(published.assets).sort()).toEqual([
      'component-fallback',
      'flow-image',
      'instance-cover',
      'runtime-fallback',
      'slide-image',
      'state-cover',
    ])
    expect(published.assets).not.toHaveProperty('unused')
    expect(Object.keys(published.components)).toEqual(['component.quiz@4.0.0'])
  })

  it('copies Flow blocks and Spatial world data without claiming host playback', () => {
    const published = buildPublishedCourseV2Payload(mixedSources())
    const flow = published.surfaces.find((surface) => surface.type === 'flow')
    const spatial = published.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (flow?.type !== 'flow') throw new Error('expected flow surface')
    if (spatial?.type !== 'spatial-2d') throw new Error('expected spatial surface')

    expect(flow.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'flow-heading',
        type: 'heading',
        text: '长文标题',
        runs: [{ start: 0, end: 4, style: { bold: true } }],
      }),
    ]))
    const section = flow.blocks.find((block) => block.type === 'section')
    if (section?.type !== 'section') throw new Error('expected nested flow section')
    expect(section.blocks).toEqual([expect.objectContaining({
      id: 'flow-media',
      type: 'media',
      assetId: 'flow-image',
    })])

    expect(spatial.world.layerItems.map((item) => item.layerItemId)).toEqual(['spatial-a', 'spatial-b'])
    expect(spatial.world.paths).toEqual([{
      id: 'path-1',
      name: '探索路线',
      layerItemIds: ['spatial-a', 'spatial-b'],
      style: { color: '#112233', width: 3, dash: 'dashed' },
    }])
    expect(spatial.world.relations).toEqual([{
      id: 'relation-1',
      sourceLayerItemId: 'spatial-a',
      targetLayerItemId: 'spatial-b',
      label: '从甲到乙',
      kind: 'arrow',
    }])
    expect(spatial.camera.frames).toEqual([
      { id: 'spatial-home', name: 'Home', x: 0, y: 0, zoom: 1 },
    ])

    expect(published).not.toHaveProperty('createdAt')
    expect(published).not.toHaveProperty('revision')
    expect(JSON.stringify(published)).not.toContain('"label":"全局条"')
    expect(JSON.stringify(published)).not.toContain('"locked":')
    const runtime = published.surfaces[0]
    if (runtime?.type !== 'slide') throw new Error('expected slide')
    const runtimeItem = runtime.scenes[0]?.layerItems.find((item) => item.kind === 'runtime')
    if (runtimeItem?.kind !== 'runtime') throw new Error('expected runtime item')
    expect(runtimeItem.runtime).not.toHaveProperty('source')
    expect(runtimeItem.runtime.code.encoding).toBe('base64-utf16le')
    expect(runtimeItem.runtime.code.data.length).toBeGreaterThan(0)
    expect(published).not.toHaveProperty('played')
    expect(published).not.toHaveProperty('playbackResult')
  })

  it('uses the same source facts as package preflight before producing V2', () => {
    const ready = mutableMixedSources()
    const readyReport = collectCoursePackageExportPreflight(
      ready.project,
      'web-package',
      { assetFiles: ready.assetFiles, components: ready.components },
      PLAYER_BUNDLE,
      new Date(NOW),
    )
    expect(readyReport.summary.canExport).toBe(true)
    expect(() => buildPublishedCourseV2Payload(ready)).not.toThrow()

    const cases: Array<{
      name: string
      code: PublishedCourseSourceIssueCode
      path: ReadonlyArray<string | number>
      mutate(sources: MutableCoursePublishSources): void
    }> = [
      {
        name: 'missing asset metadata',
        code: 'asset-metadata-missing',
        path: ['assets', 'slide-image'],
        mutate(sources) {
          delete sources.project.assets['slide-image']
        },
      },
      {
        name: 'missing asset bytes',
        code: 'asset-bytes-missing',
        path: ['assets', 'slide-image'],
        mutate(sources) {
          delete sources.assetFiles['slide-image']
        },
      },
      {
        name: 'asset byte length mismatch',
        code: 'asset-byte-length-mismatch',
        path: ['assets', 'slide-image', 'byteLength'],
        mutate(sources) {
          sources.assetFiles['slide-image'] = new Uint8Array([1, 2])
        },
      },
      {
        name: 'missing component metadata',
        code: 'component-metadata-missing',
        path: ['componentPackages', 'component.quiz'],
        mutate(sources) {
          delete sources.project.componentPackages['component.quiz']
        },
      },
      {
        name: 'missing component bytes',
        code: 'component-bytes-missing',
        path: ['componentPackages', 'component.quiz'],
        mutate(sources) {
          delete sources.components['component.quiz']
        },
      },
      {
        name: 'component manifest identity mismatch',
        code: 'component-manifest-identity-mismatch',
        path: ['componentPackages', 'component.quiz'],
        mutate(sources) {
          const component = sources.components['component.quiz']!
          sources.components['component.quiz'] = {
            ...component,
            manifest: { ...component.manifest, id: 'component.other' },
          }
        },
      },
      {
        name: 'component content hash mismatch',
        code: 'component-hash-mismatch',
        path: ['componentPackages', 'component.quiz', 'contentSha256'],
        mutate(sources) {
          sources.project.componentPackages['component.quiz']!.contentSha256 = '0'.repeat(64)
        },
      },
      {
        name: 'component asset closure missing bytes',
        code: 'component-asset-bytes-missing',
        path: ['componentPackages', 'component.quiz'],
        mutate(sources) {
          const component = sources.components['component.quiz']!
          const files = { ...component.files }
          delete files['assets/icon.png']
          const contentSha256 = componentContentSha256(files)
          sources.components['component.quiz'] = { ...component, files, contentSha256 }
          sources.project.componentPackages['component.quiz']!.contentSha256 = contentSha256
        },
      },
    ]

    for (const scenario of cases) {
      const sources = mutableMixedSources()
      scenario.mutate(sources)
      const report = collectCoursePackageExportPreflight(
        sources.project,
        'web-package',
        { assetFiles: sources.assetFiles, components: sources.components },
        PLAYER_BUNDLE,
        new Date(NOW),
      )
      expect(report.summary.canExport, scenario.name).toBe(false)
      expect(report.items, scenario.name).toContainEqual(expect.objectContaining({
        severity: 'error',
        code: scenario.code,
        path: scenario.path,
      }))

      try {
        buildPublishedCourseV2Payload(sources)
        throw new Error(`expected producer to reject ${scenario.name}`)
      } catch (error) {
        expect(error, scenario.name).toBeInstanceOf(PublishedCourseSourceError)
        expect(error, scenario.name).toMatchObject({
          code: scenario.code,
          path: scenario.path,
        })
      }
    }
  })

  it('rejects a raw V8 project and missing asset bytes', () => {
    const v8 = createProject({
      id: 'v8-raw',
      title: 'V8 工程',
      includeDefaultController: false,
      controls: 'none',
    })
    expect(() => buildPublishedCourseV2Payload({
      project: v8 as unknown as CourseProjectDocument,
      assetFiles: {},
      components: {},
    })).toThrow()

    const sources = mixedSources()
    const { 'slide-image': _omit, ...rest } = sources.assetFiles
    expect(() => buildPublishedCourseV2Payload({
      ...sources,
      assetFiles: rest,
    })).toThrow(/slide-image/)
  })
})
