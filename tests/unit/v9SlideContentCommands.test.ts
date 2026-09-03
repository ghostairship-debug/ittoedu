import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'
import type { ComponentManifestV4 } from '@/shared/componentTypes'
import { createImageNode, createTextNode, createVideoNode } from '@/renderer/project/nativeNodeFactories'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  openSlideAuthoringSession,
  setSlideEditingScope,
  type SlideAuthoringSession,
} from '@/renderer/course/slideAuthoringBackend'
import {
  addSlideComponentLayer,
  addSlideImageLayer,
  addSlideRuntimeLayer,
  addSlideTextLayer,
  addSlideVideoLayer,
  applySlideComponentPreset,
  applySlideComponentVariant,
  makeSlideAuthoringTarget,
  offsetDefaultSlideInsertion,
  readSlideComponentLayer,
  readSlideNativeLayer,
  readSlideRuntimeLayer,
  readSlideSceneInteractions,
  readSlideSimpleEntranceAnimation,
  replaceSlideMediaAsset,
  setSlideSimpleEntranceAnimation,
  SLIDE_DEFAULT_INSERTION_COLUMNS,
  SLIDE_DEFAULT_INSERTION_OFFSET,
  slideSimpleEntrancePreviewRequest,
  updateSlideComponentNestedContent,
  updateSlideComponentProps,
  updateSlideNativeLayerContent,
  updateSlideRuntimeAsset,
  updateSlideRuntimeContentValue,
  upsertSlideInteractionRule,
} from '@/renderer/course/v9SlideContentCommands'

/**
 * V9 candidate fixture. Proves Slide content commands (insert offset, media,
 * component, runtime, animation data). Does not prove Workspace, MediaTab,
 * ComponentsTab, Player, or animation preview bus wiring.
 */
const NOW = '2026-08-17T14:00:00.000Z'
const PACKAGE_SHA = 'ab'.repeat(32)

const componentManifest: ComponentManifestV4 = {
  schemaVersion: 4,
  runtimeApiVersion: 4,
  renderMode: 'dom',
  supportedScopes: ['scene', 'global'],
  id: 'com.example.v4-dom',
  name: 'V4 DOM 组件',
  version: '4.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 640, height: 360 },
  minSize: { width: 160, height: 90 },
  preserveAspectRatio: true,
  assets: {},
  defaultProps: {
    content: {
      title: '默认标题',
      rows: [
        { label: '第一行', value: '10' },
        { label: '第二行', value: '20' },
      ],
    },
    density: 'comfortable',
  },
  editor: {
    properties: [{ key: 'content.title', label: '标题', type: 'text' }],
  },
  variants: [{
    id: 'dense',
    label: '密排',
    props: { density: 'compact' },
  }],
  presets: [{
    id: 'compact',
    label: '紧凑',
    variantId: 'dense',
    props: {
      content: { rows: [{ value: '12' }] },
    },
  }],
}

function documentShell(): CourseProjectDocument {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r2d-slide-content',
    revision: 1,
    title: 'R2-D Slide content',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-photo': {
        id: 'asset-photo',
        filename: 'photo.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/photo.png',
        byteLength: 8,
        width: 800,
        height: 600,
      },
      'asset-photo-b': {
        id: 'asset-photo-b',
        filename: 'photo-b.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/photo-b.png',
        byteLength: 8,
        width: 640,
        height: 480,
      },
      'asset-clip': {
        id: 'asset-clip',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/clip.mp4',
        byteLength: 16,
        width: 1280,
        height: 720,
        duration: 12,
      },
    },
    componentPackages: {
      'com.example.v4-dom': {
        packageId: 'com.example.v4-dom',
        version: '4.0.0',
        name: 'V4 DOM 组件',
        manifestPath: 'components/com.example.v4-dom/manifest.json',
        runtimePath: 'components/com.example.v4-dom/runtime.js',
        contentSha256: PACKAGE_SHA,
      },
    },
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
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
    locations: [{
      id: 'location-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    }],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [],
        interactions: [],
      }],
    }],
  })
}

function lockedImageFixture(): CourseProjectDocument {
  const project = documentShell()
  const node = createImageNode({
    id: 'locked-photo',
    name: '锁定图片',
    assetId: 'asset-photo',
    x: 40,
    y: 40,
    locked: true,
  })
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide')
  surface.scenes[0]!.layerItems = [{
    layerItemId: node.id,
    label: node.name,
    frame: { mode: 'absolute', x: node.x, y: node.y, width: node.width, height: node.height },
    order: 1,
    visible: true,
    locked: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'image',
      data: {
        assetId: node.assetId,
        preserveAspectRatio: node.preserveAspectRatio,
        fit: node.fit,
        crop: node.crop,
        cropX: node.cropX,
        cropY: node.cropY,
        flipX: node.flipX,
        flipY: node.flipY,
        cornerRadius: node.cornerRadius,
        feather: node.feather,
        safeAreas: node.safeAreas,
      },
    },
  }]
  return courseProjectDocumentSchema.parse(project)
}

function requireSession(result: { ok: boolean; reason?: string; nextSession?: SlideAuthoringSession }) {
  if (!result.ok || !result.nextSession) {
    throw new Error(result.reason ?? (result.ok ? 'missing session' : 'command failed'))
  }
  return result.nextSession
}

function sceneItems(session: SlideAuthoringSession) {
  const surface = session.history.present.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide')
  return surface.scenes[0]!.layerItems
}

function v8Offset<T extends { x: number; y: number }>(
  item: T,
  existingCount: number,
  hasExplicitPosition: boolean,
): T {
  if (hasExplicitPosition) return item
  const slot = existingCount % (SLIDE_DEFAULT_INSERTION_COLUMNS * 4)
  return {
    ...item,
    x: item.x + (slot % SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
    y: item.y + Math.floor(slot / SLIDE_DEFAULT_INSERTION_COLUMNS) * SLIDE_DEFAULT_INSERTION_OFFSET,
  }
}

describe('V9 Slide content commands', () => {
  it('keeps the V8 default insertion offset contract', () => {
    expect(SLIDE_DEFAULT_INSERTION_COLUMNS).toBe(6)
    expect(SLIDE_DEFAULT_INSERTION_OFFSET).toBe(20)
    const origin = { x: 480, y: 270 }
    expect(offsetDefaultSlideInsertion(origin, 0, false)).toEqual({ x: 480, y: 270 })
    expect(offsetDefaultSlideInsertion(origin, 1, false)).toEqual({ x: 500, y: 270 })
    expect(offsetDefaultSlideInsertion(origin, 6, false)).toEqual({ x: 480, y: 290 })
    expect(offsetDefaultSlideInsertion(origin, 1, true)).toEqual(origin)
    expect(offsetDefaultSlideInsertion(origin, 23, false)).toEqual(
      v8Offset(origin, 23, false),
    )
  })

  it('staggers consecutive default inserts the same way as V8', () => {
    const source = documentShell()
    let session = openSlideAuthoringSession(source)
    const expectedText = v8Offset(createTextNode(), 0, false)
    const expectedImage = v8Offset(
      createImageNode('asset-photo', 800, 600),
      1,
      false,
    )
    const expectedVideo = v8Offset(
      createVideoNode({ assetId: 'asset-clip', width: 1280, height: 720 }),
      2,
      false,
    )

    session = requireSession(addSlideTextLayer(session, {}, { now: NOW }))
    session = requireSession(addSlideImageLayer(session, { assetId: 'asset-photo' }, { now: NOW }))
    session = requireSession(addSlideVideoLayer(session, { assetId: 'asset-clip' }, { now: NOW }))

    const [text, image, video] = sceneItems(session)
    expect(new Set(sceneItems(session).map((item) => `${item.frame.x}:${item.frame.y}`)).size)
      .toBe(3)
    expect(text?.frame).toMatchObject({ x: expectedText.x, y: expectedText.y })
    expect(image?.frame).toMatchObject({ x: expectedImage.x, y: expectedImage.y })
    expect(video?.frame).toMatchObject({ x: expectedVideo.x, y: expectedVideo.y })
    expect(session.history.present.schemaVersion).toBe(9)
    expect(source.surfaces[0]).toEqual(documentShell().surfaces[0])
  })

  it('allocates Slide items after Spatial content from the course-wide order namespace', () => {
    const source = documentShell()
    const worldItem = sceneNodeToCourseLayerItem(createTextNode({
      id: 'spatial-world-text',
      name: '空间文字',
      text: '先创建的空间内容',
    }))
    worldItem.order = 0
    source.locations.push({
      id: 'location-spatial-home',
      label: '空间首页',
      kind: 'spatial-camera',
      surfaceId: 'surface-spatial',
      cameraFrameId: 'camera-spatial-home',
    })
    source.surfaces.push({
      id: 'surface-spatial',
      title: '空间',
      type: 'spatial-2d',
      surfaceLayerItems: [],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [worldItem],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [{ id: 'camera-spatial-home', name: '首页', x: 0, y: 0, zoom: 1 }],
      },
      semanticZoom: [],
    })
    source.mixedPrintPlan = {
      pageSize: 'A4',
      orientation: 'auto',
      entries: [
        {
          id: 'print-slide',
          kind: 'slide-scenes',
          surfaceId: 'surface-slide',
          sceneIds: ['scene-1'],
        },
        {
          id: 'print-spatial',
          kind: 'spatial-frames',
          surfaceId: 'surface-spatial',
          cameraFrameIds: ['camera-spatial-home'],
        },
      ],
    }
    const sourceBefore = structuredClone(source)

    let session = requireSession(addSlideTextLayer(
      openSlideAuthoringSession(source),
      { id: 'slide-after-spatial' },
      { now: NOW },
    ))
    session = requireSession(addSlideComponentLayer(
      session,
      {
        packageId: 'com.example.v4-dom',
        id: 'component-after-spatial',
        manifest: componentManifest,
      },
      { now: NOW },
    ))
    const runtime = addSlideRuntimeLayer(
      session,
      { id: 'runtime-after-spatial' },
      { now: NOW },
    )
    expect(runtime.historyEntry).toBe(true)
    session = requireSession(runtime)

    const spatial = session.history.present.surfaces.find(
      (surface) => surface.id === 'surface-spatial',
    )
    if (!spatial || spatial.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const orders = [
      ...spatial.world.layerItems.map((item) => item.order),
      ...sceneItems(session).map((item) => item.order),
    ]
    expect(orders).toEqual([0, 1, 2, 3])
    expect(new Set(orders).size).toBe(orders.length)
    expect(session.history.past).toHaveLength(3)
    expect(source).toEqual(sourceBefore)
  })

  it('does not offset an insert that already has an explicit position', () => {
    const session = requireSession(addSlideImageLayer(
      openSlideAuthoringSession(documentShell()),
      { assetId: 'asset-photo', x: 80, y: 60 },
      { now: NOW },
    ))
    expect(sceneItems(session)[0]?.frame).toMatchObject({ x: 80, y: 60 })
  })

  it('adds, replaces, crops and fits a scene Native image', () => {
    const added = addSlideImageLayer(
      openSlideAuthoringSession(documentShell()),
      { assetId: 'asset-photo', id: 'photo-1' },
      { now: NOW },
    )
    expect(added.historyEntry).toBe(true)
    let session = requireSession(added)
    expect(session.history.present.revision).toBe(2)
    expect(session.selection.selectionIds).toEqual(['photo-1'])

    const imageLayer = readSlideNativeLayer(session, 'photo-1')
    expect(imageLayer.content.nativeType).toBe('image')
    if (imageLayer.content.nativeType !== 'image') throw new Error('expected image')
    expect(imageLayer.content.data.assetId).toBe('asset-photo')
    expect(imageLayer.content.data.fit).toBe('contain')
    expect(imageLayer.kind).toBe('native')

    session = requireSession(replaceSlideMediaAsset(session, 'photo-1', 'asset-photo-b', { now: NOW }))
    expect(readSlideNativeLayer(session, 'photo-1').content).toMatchObject({
      nativeType: 'image',
      data: { assetId: 'asset-photo-b' },
    })

    session = requireSession(updateSlideNativeLayerContent(session, 'photo-1', {
      nativeData: {
        fit: 'cover',
        crop: { left: 0.1, top: 0.05, right: 0.08, bottom: 0.04 },
        cropX: 0.3,
        cropY: 0.7,
      },
    }, { now: NOW }))
    const updated = readSlideNativeLayer(session, 'photo-1')
    if (updated.content.nativeType !== 'image') throw new Error('expected image')
    expect(updated.content.data).toMatchObject({
      assetId: 'asset-photo-b',
      fit: 'cover',
      crop: { left: 0.1, top: 0.05, right: 0.08, bottom: 0.04 },
      cropX: 0.3,
      cropY: 0.7,
    })
    expect(session.history.past).toHaveLength(3)
    expect(courseProjectDocumentSchema.parse(session.history.present)).toEqual(
      session.history.present,
    )
  })

  it('adds a scene Native video and writes playback fields', () => {
    let session = requireSession(addSlideVideoLayer(
      openSlideAuthoringSession(documentShell()),
      { assetId: 'asset-clip', id: 'video-1' },
      { now: NOW },
    ))
    session = requireSession(updateSlideNativeLayerContent(session, 'video-1', {
      nativeData: { fit: 'cover', autoplay: true, loop: true, muted: true },
    }, { now: NOW }))
    const video = readSlideNativeLayer(session, 'video-1')
    expect(video.content.nativeType).toBe('video')
    if (video.content.nativeType !== 'video') throw new Error('expected video')
    expect(video.content.data).toMatchObject({
      assetId: 'asset-clip',
      fit: 'cover',
      autoplay: true,
      loop: true,
      muted: true,
    })
  })

  it('reads and writes component props, variant, preset and nested content', () => {
    let session = requireSession(addSlideComponentLayer(
      openSlideAuthoringSession(documentShell()),
      { packageId: 'com.example.v4-dom', id: 'comp-1', manifest: componentManifest },
      { now: NOW },
    ))
    expect(readSlideComponentLayer(session, 'comp-1')).toMatchObject({
      kind: 'component',
      component: { packageId: 'com.example.v4-dom', version: '4.0.0' },
      props: {
        content: { title: '默认标题' },
        density: 'comfortable',
      },
    })

    session = requireSession(updateSlideComponentNestedContent(
      session,
      'comp-1',
      'content.title',
      '实例标题',
      { now: NOW },
    ))
    expect(readSlideComponentLayer(session, 'comp-1').props).toMatchObject({
      content: {
        title: '实例标题',
        rows: [
          { label: '第一行', value: '10' },
          { label: '第二行', value: '20' },
        ],
      },
    })

    session = requireSession(applySlideComponentVariant(
      session,
      'comp-1',
      'dense',
      componentManifest,
      { now: NOW },
    ))
    expect(readSlideComponentLayer(session, 'comp-1').props).toMatchObject({
      density: 'compact',
      content: { title: '实例标题' },
    })

    session = requireSession(applySlideComponentPreset(
      session,
      'comp-1',
      'compact',
      componentManifest,
      { now: NOW },
    ))
    expect(readSlideComponentLayer(session, 'comp-1').props).toMatchObject({
      density: 'compact',
      content: {
        title: '默认标题',
        rows: [
          { label: '第一行', value: '12' },
          { label: '第二行', value: '20' },
        ],
      },
    })

    session = requireSession(updateSlideComponentProps(session, 'comp-1', {
      ...readSlideComponentLayer(session, 'comp-1').props,
      density: 'comfortable',
    }, { now: NOW }))
    expect(readSlideComponentLayer(session, 'comp-1').props.density).toBe('comfortable')
  })

  it('keeps a Runtime authoringAddress and stable asset references', () => {
    let session = requireSession(addSlideRuntimeLayer(
      openSlideAuthoringSession(documentShell()),
      {
        id: 'runtime-1',
        runtime: {
          protocol: 'surface-runtime',
          runtimeApiVersion: 3,
          enabled: true,
          renderMode: 'dom',
          source: 'CoursewareRuntime.define({ runtimeApiVersion: 3, protocol: "surface-runtime" })',
          content: {
            values: { title: '动态标题' },
            metadata: { title: { label: '标题' } },
          },
          assets: { hero: { assetId: 'asset-photo' } },
        },
      },
      { now: NOW },
    ))
    const target = makeSlideAuthoringTarget(session, 'runtime-1', 'runtime.assets.hero')
    expect(target.authoringAddress).toBe(makeAuthoringAddress({
      projectId: 'r2d-slide-content',
      scope: 'scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
      carrier: 'runtime',
      layerItemId: 'runtime-1',
      field: 'runtime.assets.hero',
    }))
    expect(target.authoringAddress).not.toMatch(/hit/i)

    session = requireSession(updateSlideRuntimeContentValue(
      session,
      'runtime-1',
      'title',
      '新标题',
      { now: NOW },
    ))
    session = requireSession(updateSlideRuntimeAsset(
      session,
      'runtime-1',
      'hero',
      'asset-photo-b',
      { now: NOW },
    ))
    const runtime = readSlideRuntimeLayer(session, 'runtime-1')
    expect(runtime.runtime.content.values.title).toBe('新标题')
    expect(runtime.runtime.assets.hero).toEqual({ assetId: 'asset-photo-b' })
    expect(session.history.present.assets['asset-photo-b']?.id).toBe('asset-photo-b')
  })

  it('reads and writes simple entrance animation as V8-compatible node.enter data', () => {
    let session = requireSession(addSlideImageLayer(
      openSlideAuthoringSession(documentShell()),
      { assetId: 'asset-photo', id: 'anim-photo' },
      { now: NOW },
    ))
    session = requireSession(setSlideSimpleEntranceAnimation(session, 'anim-photo', {
      effect: 'slide',
      direction: 'left',
      durationMs: 420,
      delayMs: 80,
    }, { now: NOW }))

    expect(readSlideSimpleEntranceAnimation(session, 'anim-photo')).toEqual({
      effect: 'slide',
      direction: 'left',
      durationMs: 420,
      delayMs: 80,
    })
    expect(readSlideNativeLayer(session, 'anim-photo').playbackInitialVisibility).toBe('hidden')
    expect(slideSimpleEntrancePreviewRequest(session, 'anim-photo')).toEqual({
      delayMs: 80,
      action: {
        type: 'node.enter',
        nodeId: 'anim-photo',
        effect: 'slide',
        direction: 'left',
        durationMs: 420,
        easing: 'ease-out',
      },
    })

    session = requireSession(setSlideSimpleEntranceAnimation(session, 'anim-photo', null, { now: NOW }))
    expect(readSlideSimpleEntranceAnimation(session, 'anim-photo')).toBeNull()
    expect(readSlideNativeLayer(session, 'anim-photo').playbackInitialVisibility).toBe('inherit')
  })

  it('reads and writes professional automation/interaction rules', () => {
    let session = requireSession(addSlideImageLayer(
      openSlideAuthoringSession(documentShell()),
      { assetId: 'asset-photo', id: 'auto-photo' },
      { now: NOW },
    ))
    session = requireSession(upsertSlideInteractionRule(session, {
      id: 'rule-click-enter',
      name: '点击后出现',
      enabled: true,
      trigger: { type: 'node.click', nodeId: 'auto-photo' },
      conditions: [],
      actions: [{
        id: 'action-enter',
        start: 'after-previous',
        delayMs: 0,
        action: {
          type: 'node.enter',
          nodeId: 'auto-photo',
          effect: 'fade',
          durationMs: 300,
          easing: 'ease-out',
        },
      }],
    }, { now: NOW }))

    expect(readSlideSceneInteractions(session)).toEqual([expect.objectContaining({
      id: 'rule-click-enter',
      trigger: { type: 'node.click', nodeId: 'auto-photo' },
      actions: [expect.objectContaining({
        action: expect.objectContaining({
          type: 'node.enter',
          nodeId: 'auto-photo',
          effect: 'fade',
        }),
      })],
    })])
    expect(
      setSlideSimpleEntranceAnimation(session, 'auto-photo', {
        effect: 'fade',
        durationMs: 420,
        delayMs: 0,
      }).reason,
    ).toContain('专业动画规则')
  })

  it('rejects locked, stale-revision and wrong-owner writes without a history entry', () => {
    const locked = openSlideAuthoringSession(lockedImageFixture())
    expect(replaceSlideMediaAsset(locked, 'locked-photo', 'asset-photo-b').reason)
      .toBe(SLIDE_REJECT_LOCKED)
    expect(replaceSlideMediaAsset(locked, 'locked-photo', 'asset-photo-b').historyEntry)
      .toBe(false)

    const session = openSlideAuthoringSession(documentShell())
    expect(addSlideImageLayer(session, { assetId: 'asset-photo' }, { expectedRevision: 99 }).reason)
      .toBe(SLIDE_REJECT_STALE_REVISION)

    const globalScope = requireSession(setSlideEditingScope(session, 'global'))
    expect(addSlideImageLayer(globalScope, { assetId: 'asset-photo' }).reason)
      .toBe(SLIDE_REJECT_WRONG_OWNER)
    expect(globalScope.history.present).toBe(session.history.present)
  })
})
