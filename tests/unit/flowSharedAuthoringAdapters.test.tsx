import { describe, expect, it } from 'vitest'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import { getEffectiveCourseLayerOrder } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import type { ComponentManifest } from '@/shared/componentTypes'
import {
  createTeacherControllerNode,
  createTextNode,
} from '@/renderer/project/createProject'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  enterFlowTextEditing,
  selectFlowEditorBlock,
  selectFlowGlobalScope,
  selectFlowOverlay,
  type FlowEditorSelection,
} from '@/renderer/course/flowEditorSlice'
import {
  FLOW_AUDIO_OVERLAY_REASON,
  FLOW_CONTROLLER_NOT_FOOTER_REASON,
  FLOW_DOCUMENT_LAYER_REASON,
  FLOW_EMBED_COMPONENT_FALLBACK_REASON,
  FLOW_EMPTY_ASSET_REASON,
  FLOW_GLOBAL_STRUCTURE_REASON,
  FLOW_MEDIA_ONLY_CONVERT_REASON,
  FLOW_NO_PAGE_REASON,
  FLOW_PARAGRAPH_INTERACTION_REASON,
  FLOW_RUNTIME_EMBED_REASON,
  FLOW_SHAPE_EMBED_REASON,
  classifyFlowSharedDelete,
  classifyFlowSharedInteraction,
  classifyFlowTeacherControllerRole,
  convertFlowComponentBlockToOverlay,
  convertFlowMediaBlockToOverlay,
  convertFlowOverlayComponentToDocument,
  convertFlowOverlayMediaToDocument,
  enterFlowGlobalAuthoring,
  executeFlowSharedDelete,
  insertFlowSharedComponent,
  insertFlowSharedMedia,
  insertFlowSharedRuntime,
  insertFlowSharedShape,
  readFlowSharedOwnership,
  resolveFlowMediaInsertPlacement,
  setFlowOverlayVisibleAtLocation,
} from '@/renderer/course/flowSharedAuthoringAdapters'
import {
  FLOW_DOCUMENT_HIT_NOT_OVERLAY_REASON,
  resolveFlowOverlayAuthoringTarget,
  selectFlowAuthoringFromOverlayHit,
} from '@/renderer/authoring/flowOverlayAuthoring'
import { projectFlowUnifiedOverlays } from '@/renderer/course/flowOverlayProjection'

const NOW = '2026-08-17T17:10:00.000Z'
const PACKAGE_SHA = 'cd'.repeat(32)

const componentManifest: ComponentManifest = {
  schemaVersion: 4,
  runtimeApiVersion: 4,
  renderMode: 'dom',
  supportedScopes: ['scene', 'global'],
  id: 'com.example.flow',
  name: 'Flow 组件',
  version: '1.0.0',
  entry: 'runtime.js',
  defaultSize: { width: 480, height: 280 },
  minSize: { width: 120, height: 80 },
  preserveAspectRatio: true,
  assets: {},
  defaultProps: { title: '默认标题' },
  editor: { properties: [{ key: 'title', label: '标题', type: 'text' }] },
}

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-shared-adapters',
    revision: 3,
    title: 'Flow 共享适配',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover.png',
        byteLength: 1024,
        width: 640,
        height: 360,
      },
      'asset-video': {
        id: 'asset-video',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'media/clip.mp4',
        byteLength: 2048,
        width: 1280,
        height: 720,
      },
      'asset-audio': {
        id: 'asset-audio',
        filename: 'voice.mp3',
        mimeType: 'audio/mpeg',
        kind: 'audio',
        path: 'media/voice.mp3',
        byteLength: 512,
      },
      'asset-fallback': {
        id: 'asset-fallback',
        filename: 'fallback.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/fallback.png',
        byteLength: 64,
        width: 120,
        height: 80,
      },
    },
    componentPackages: {
      'com.example.flow': {
        packageId: 'com.example.flow',
        version: '1.0.0',
        name: 'Flow 组件',
        manifestPath: 'components/com.example.flow/manifest.json',
        runtimePath: 'components/com.example.flow/runtime.js',
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
    globalLayerItems: [{
      item: sceneNodeToCourseLayerItem(createTeacherControllerNode({
        id: 'teacher-controller-main',
      }), 90),
      visibility: { mode: 'all', locationIds: [] },
    }],
    globalInteractions: [],
  }
}

function createFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '标题一' },
    { id: 'p-body', type: 'paragraph', text: '普通段落' },
    {
      id: 'media-inline',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      caption: '文中图',
      layout: 'content-width',
    },
    {
      id: 'media-audio',
      type: 'media',
      assetId: 'asset-audio',
      mediaKind: 'audio',
      caption: '文中声音',
      layout: 'content-width',
    },
    {
      id: 'component-inline',
      type: 'component',
      component: { packageId: 'com.example.flow', version: '1.0.0' },
      props: { title: '文中组件' },
      staticFallbackAssetId: 'asset-fallback',
    },
    { id: 'h2', type: 'heading', level: 2, text: '标题二' },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '标题一',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [{
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'overlay-text',
          name: '浮层文字',
          text: '浮层',
        }), 20),
        visibility: { mode: 'all', locationIds: [] },
      }],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

function flowOf(project: CourseProjectDocument) {
  const surface = project.surfaces.find((candidate) => candidate.id === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow')
  return surface
}

function engineIds(project: CourseProjectDocument, locationId = 'h1') {
  return getEffectiveCourseLayerOrder({
    project,
    surfaceId: 'flow',
    locationId,
  }).map((entry) => entry.item.layerItemId)
}

function idleSelection(): FlowEditorSelection {
  return {
    locationId: '',
    surfaceId: 'flow',
    authoringScope: 'page',
    focus: 'idle',
    selectedBlockId: null,
    selectedBlockIds: [],
    selectedOverlayIds: [],
    textRange: null,
    authoringAddress: 'unused',
  }
}

describe('Flow shared authoring adapters', () => {
  it('inserts image, video and audio as in-document media by default and keeps them off layers', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'p-body')
    expect(resolveFlowMediaInsertPlacement({})).toBe('document-block')
    expect(resolveFlowMediaInsertPlacement({ altKey: true })).toBe('viewport-overlay')

    const image = insertFlowSharedMedia(project, selection, {
      assetId: 'asset-image',
      id: 'inserted-image',
    }, { now: NOW })
    expect(image.ok).toBe(true)
    expect(image.historyEntry).toBe(true)
    expect(image.ownership).toBe('document-block')
    expect(image.nextDocument!.revision).toBe(project.revision + 1)
    expect(readFlowSharedOwnership(image.nextDocument!, 'inserted-image')).toBe('document-block')
    expect(engineIds(image.nextDocument!)).not.toContain('inserted-image')

    const video = insertFlowSharedMedia(image.nextDocument!, selection, {
      assetId: 'asset-video',
      id: 'inserted-video',
    }, { now: NOW })
    expect(video.ownership).toBe('document-block')
    expect(engineIds(video.nextDocument!)).not.toContain('inserted-video')

    const audio = insertFlowSharedMedia(video.nextDocument!, selection, {
      assetId: 'asset-audio',
      id: 'inserted-audio',
    }, { now: NOW })
    expect(audio.ok).toBe(true)
    expect(audio.ownership).toBe('document-block')
    const audioBlock = flowOf(audio.nextDocument!).blocks.find((block) => block.id === 'inserted-audio')
    expect(audioBlock).toMatchObject({ type: 'media', mediaKind: 'audio' })
    expect(engineIds(audio.nextDocument!)).not.toContain('inserted-audio')
    expect(projectFlowUnifiedOverlays(audio.nextDocument!, 'h1').nodesTabIds)
      .not.toEqual(expect.arrayContaining(['inserted-image', 'inserted-video', 'inserted-audio']))
  })

  it('adds image as a page overlay only when explicitly requested, and refuses empty success', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'p-body')
    const overlay = insertFlowSharedMedia(project, selection, {
      assetId: 'asset-image',
      altKey: true,
      id: 'overlay-photo',
    }, { now: NOW })
    expect(overlay.ok).toBe(true)
    expect(overlay.historyEntry).toBe(true)
    expect(overlay.ownership).toBe('viewport-overlay')
    expect(flowOf(overlay.nextDocument!).blocks.some((block) => block.id === 'overlay-photo')).toBe(false)
    expect(engineIds(overlay.nextDocument!)).toContain('overlay-photo')
    expect(readFlowSharedOwnership(overlay.nextDocument!, 'overlay-photo')).toBe('viewport-overlay')
    expect(locateCourseLayer(overlay.nextDocument!, 'overlay-photo')?.item.paperSpace).toBe('paper')

    const videoOverlay = insertFlowSharedMedia(project, selection, {
      assetId: 'asset-video',
      placement: 'viewport-overlay',
      id: 'overlay-video',
    }, { now: NOW })
    expect(videoOverlay.ok).toBe(true)
    expect(locateCourseLayer(videoOverlay.nextDocument!, 'overlay-video')?.item.paperSpace).toBe('paper')

    const empty = insertFlowSharedMedia(project, selection, {}, { now: NOW })
    expect(empty.ok).toBe(false)
    expect(empty.historyEntry).toBe(false)
    expect(empty.nextDocument).toBeUndefined()
    expect(empty.reason).toBe(FLOW_EMPTY_ASSET_REASON)

    const noPage = insertFlowSharedMedia(project, idleSelection(), { assetId: 'asset-image' })
    expect(noPage.ok).toBe(false)
    expect(noPage.reason).toBe(FLOW_NO_PAGE_REASON)

    const audioOverlay = insertFlowSharedMedia(project, selection, {
      assetId: 'asset-audio',
      placement: 'viewport-overlay',
    })
    expect(audioOverlay.ok).toBe(false)
    expect(audioOverlay.reason).toBe(FLOW_AUDIO_OVERLAY_REASON)
    expect(engineIds(project)).not.toContain('media-audio')
    expect(flowOf(project).blocks.some((block) => block.id === 'media-audio')).toBe(true)
  })

  it('inserts component and runtime as overlays by default, shape as overlay, and optional document component', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'p-body')
    const overlay = insertFlowSharedComponent(project, selection, {
      packageId: 'com.example.flow',
      manifest: componentManifest,
      staticFallbackAssetId: 'asset-fallback',
      id: 'overlay-component',
    }, { now: NOW })
    expect(overlay.ok).toBe(true)
    expect(overlay.ownership).toBe('viewport-overlay')
    expect(engineIds(overlay.nextDocument!)).toContain('overlay-component')

    const embedded = insertFlowSharedComponent(overlay.nextDocument!, selection, {
      packageId: 'com.example.flow',
      menuAction: 'embed-document',
      staticFallbackAssetId: 'asset-fallback',
      id: 'doc-component',
    }, { now: NOW })
    expect(embedded.ok).toBe(true)
    expect(embedded.ownership).toBe('document-block')
    expect(engineIds(embedded.nextDocument!)).not.toContain('doc-component')

    const missingFallback = insertFlowSharedComponent(project, selection, {
      packageId: 'com.example.flow',
      placement: 'document-block',
    })
    expect(missingFallback.ok).toBe(false)
    expect(missingFallback.reason).toBe(FLOW_EMBED_COMPONENT_FALLBACK_REASON)

    const runtime = insertFlowSharedRuntime(embedded.nextDocument!, selection, {
      id: 'overlay-runtime',
    }, { now: NOW })
    expect(runtime.ok).toBe(true)
    expect(runtime.ownership).toBe('viewport-overlay')
    expect(insertFlowSharedRuntime(project, selection, { placement: 'document-block' }).reason)
      .toBe(FLOW_RUNTIME_EMBED_REASON)

    const shape = insertFlowSharedShape(runtime.nextDocument!, selection, {
      shapeType: 'rectangle',
      id: 'overlay-shape',
    }, { now: NOW })
    expect(shape.ok).toBe(true)
    expect(shape.ownership).toBe('viewport-overlay')
    expect(engineIds(shape.nextDocument!)).toContain('overlay-shape')
  })

  it('converts in-document media and component to overlays once, and refuses silent layer writes', () => {
    const project = createFlowProject()
    const mediaSelection = selectFlowEditorBlock(project, 'h1', 'media-inline')
    const converted = convertFlowMediaBlockToOverlay(project, mediaSelection, { now: NOW })
    expect(converted.ok).toBe(true)
    expect(converted.historyEntry).toBe(true)
    expect(converted.nextDocument!.revision).toBe(project.revision + 1)
    expect(flowOf(converted.nextDocument!).blocks.some((block) => block.id === 'media-inline')).toBe(false)
    const overlayId = converted.createdLayerItemIds![0]!
    expect(engineIds(converted.nextDocument!)).toContain(overlayId)
    expect(readFlowSharedOwnership(converted.nextDocument!, overlayId)).toBe('viewport-overlay')
    expect(locateCourseLayer(converted.nextDocument!, overlayId)?.item.paperSpace).toBe('paper')

    const back = convertFlowOverlayMediaToDocument(
      converted.nextDocument!,
      converted.selection!,
      { now: NOW },
    )
    expect(back.ok).toBe(true)
    expect(back.historyEntry).toBe(true)
    expect(back.nextDocument!.revision).toBe(converted.nextDocument!.revision + 1)
    expect(engineIds(back.nextDocument!)).not.toContain(overlayId)
    expect(flowOf(back.nextDocument!).blocks.some((block) => block.type === 'media' && block.mediaKind === 'image'))
      .toBe(true)

    const paragraph = convertFlowMediaBlockToOverlay(
      project,
      selectFlowEditorBlock(project, 'h1', 'p-body'),
    )
    expect(paragraph.ok).toBe(false)
    expect(paragraph.reason).toBe(FLOW_MEDIA_ONLY_CONVERT_REASON)
    expect(paragraph.nextDocument).toBeUndefined()
    expect(engineIds(project)).not.toContain('p-body')
    expect(flowOf(project).blocks.some((block) => block.id === 'p-body')).toBe(true)

    const audio = convertFlowMediaBlockToOverlay(
      project,
      selectFlowEditorBlock(project, 'h1', 'media-audio'),
    )
    expect(audio.ok).toBe(false)
    expect(audio.reason).toBe(FLOW_AUDIO_OVERLAY_REASON)
    expect(engineIds(project)).not.toContain('media-audio')

    const component = convertFlowComponentBlockToOverlay(
      project,
      selectFlowEditorBlock(project, 'h1', 'component-inline'),
      { now: NOW },
    )
    expect(component.ok).toBe(true)
    expect(component.historyEntry).toBe(true)
    const componentOverlay = component.createdLayerItemIds![0]!
    expect(engineIds(component.nextDocument!)).toContain(componentOverlay)
    expect(locateCourseLayer(component.nextDocument!, componentOverlay)?.item.paperSpace).toBe('paper')
    const reembedded = convertFlowOverlayComponentToDocument(
      component.nextDocument!,
      component.selection!,
      { now: NOW },
    )
    expect(reembedded.ok).toBe(true)
    expect(reembedded.ownership).toBe('document-block')
    expect(engineIds(reembedded.nextDocument!)).not.toContain(componentOverlay)

    const shapeOverlay = insertFlowSharedShape(
      project,
      selectFlowEditorBlock(project, 'h1', 'p-body'),
      { shapeType: 'ellipse', id: 'shape-only' },
      { now: NOW },
    )
    const embedShape = convertFlowOverlayMediaToDocument(
      shapeOverlay.nextDocument!,
      shapeOverlay.selection!,
    )
    expect(embedShape.ok).toBe(false)
    expect(embedShape.reason).toBe(FLOW_SHAPE_EMBED_REASON)
  })

  it('routes delete and interaction with R4-A selection, and enters real global scope', () => {
    const project = createFlowProject()
    const overlaySelection = selectFlowOverlay(project, 'h1', ['overlay-text'])
    expect(classifyFlowSharedDelete(overlaySelection).intent).toBe('overlay-delete')
    const deleted = executeFlowSharedDelete(project, overlaySelection, { now: NOW })
    expect(deleted.ok).toBe(true)
    expect(engineIds(deleted.nextDocument!)).not.toContain('overlay-text')

    const textSelection = enterFlowTextEditing(
      project,
      selectFlowEditorBlock(project, 'h1', 'p-body'),
      { blockId: 'p-body', start: 1, end: 1 },
    )
    expect(classifyFlowSharedDelete(textSelection).intent).toBe('text-delete')
    const textDeleted = executeFlowSharedDelete(project, textSelection, { now: NOW })
    expect(textDeleted.ok).toBe(true)
    expect(engineIds(textDeleted.nextDocument!)).toContain('overlay-text')
    expect(flowOf(textDeleted.nextDocument!).blocks.some((block) => block.id === 'p-body')).toBe(true)

    const blockSelection = selectFlowEditorBlock(project, 'h1', 'p-body')
    expect(classifyFlowSharedInteraction(blockSelection)).toMatchObject({
      allowed: false,
      owner: 'document',
      reason: FLOW_PARAGRAPH_INTERACTION_REASON,
    })
    expect(classifyFlowSharedInteraction(overlaySelection)).toMatchObject({
      allowed: true,
      owner: 'overlay',
    })

    const entered = enterFlowGlobalAuthoring(project, 'h1', 'teacher-controller-main')
    expect(entered.ok).toBe(true)
    if (!entered.ok || !entered.selection) throw new Error('expected global scope')
    expect(entered.selection.authoringScope).toBe('global')
    expect(entered.selection.selectedOverlayIds).toContain('teacher-controller-main')
    const controller = classifyFlowTeacherControllerRole(project.globalLayerItems[0]!.item)
    expect(controller.placement).toBe('viewport-overlay')
    if (controller.placement !== 'viewport-overlay') throw new Error('expected viewport overlay')
    expect(controller.documentFooter).toBe(false)
    expect(controller.reason).toBe(FLOW_CONTROLLER_NOT_FOOTER_REASON)
    expect(project.globalLayerItems[0]!.item.paperSpace).toBeUndefined()
    expect(locateCourseLayer(project, 'teacher-controller-main')?.item.paperSpace).not.toBe('paper')

    const hidden = setFlowOverlayVisibleAtLocation(
      project,
      entered.selection,
      false,
      { now: NOW },
    )
    expect(hidden.ok).toBe(true)
    expect(hidden.historyEntry).toBe(true)
    expect(engineIds(hidden.nextDocument!, 'h1')).not.toContain('teacher-controller-main')
    const otherLocation = hidden.nextDocument!.locations.find(
      (location) => location.kind === 'flow-block' && location.blockId === 'h2',
    )
    expect(otherLocation).toBeDefined()
    expect(engineIds(hidden.nextDocument!, otherLocation!.id)).toContain('teacher-controller-main')

    const globalInsert = insertFlowSharedMedia(
      project,
      selectFlowGlobalScope(project, 'h1', 'teacher-controller-main'),
      { assetId: 'asset-image' },
    )
    expect(globalInsert.ok).toBe(false)
    expect(globalInsert.reason).toBe(FLOW_GLOBAL_STRUCTURE_REASON)
  })

  it('changes a surface overlay visibility only at the selected Flow location', () => {
    const project = createFlowProject()
    const selection = selectFlowOverlay(project, 'h1', ['overlay-text'])
    const hidden = setFlowOverlayVisibleAtLocation(project, selection, false, { now: NOW })

    expect(hidden.ok).toBe(true)
    expect(hidden.historyEntry).toBe(true)
    expect(hidden.nextDocument!.revision).toBe(project.revision + 1)
    expect(engineIds(hidden.nextDocument!, 'h1')).not.toContain('overlay-text')

    const otherLocation = hidden.nextDocument!.locations.find(
      (location) => location.kind === 'flow-block' && location.blockId === 'h2',
    )
    expect(otherLocation).toBeDefined()
    expect(engineIds(hidden.nextDocument!, otherLocation!.id)).toContain('overlay-text')
  })

  it('keeps overlay hits off document blocks and never persists hitId', () => {
    const project = createFlowProject()
    const leaked = resolveFlowOverlayAuthoringTarget(project, 'h1', {
      layerItemId: 'media-inline',
      hitId: 'temp-hit',
    })
    expect(leaked.ok).toBe(false)
    if (leaked.ok) throw new Error('expected document hit to miss overlay')
    expect(leaked.reason).toBe(FLOW_DOCUMENT_HIT_NOT_OVERLAY_REASON)
    expect(FLOW_DOCUMENT_LAYER_REASON).toContain('图层')

    const hit = resolveFlowOverlayAuthoringTarget(project, 'h1', {
      layerItemId: 'overlay-text',
      field: 'item',
      hitId: 'temp-hit',
    })
    expect(hit.ok).toBe(true)
    if (!hit.ok) throw new Error('expected overlay hit')
    expect(hit.authoringAddress).not.toContain('temp-hit')
    expect(hit.authoringAddress).not.toContain('hitId')
    expect(hit.ephemeralHitId).toBe('temp-hit')
    expect(hit.placement).toBe('viewport-overlay')

    const selected = selectFlowAuthoringFromOverlayHit(project, 'h1', {
      layerItemId: 'teacher-controller-main',
      hitId: 'controller-hit',
    })
    expect(selected.ok).toBe(true)
    if (!selected.ok) throw new Error('expected controller hit')
    expect(selected.selection.authoringScope).toBe('global')
    expect(selected.selection.authoringAddress).not.toContain('controller-hit')
  })
})
