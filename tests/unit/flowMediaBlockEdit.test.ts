import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { AssetMeta } from '@/shared/contracts/media-v1'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
  type FlowMediaBlock,
} from '@/shared/courseProjectTypes'
import { COURSE_AUTHORING_TARGET_REJECTION_REASONS } from '@/renderer/authoring/courseAuthoringSession'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  executeFlowEditorCommand,
  importAndReplaceFlowMediaBlock,
  replaceFlowMediaBlockAsset,
  updateFlowEditorBlock,
} from '@/renderer/course/flowEditorCommands'
import {
  flowBlockTargetFromSelection,
  selectFlowEditorBlock,
} from '@/renderer/course/flowEditorSlice'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'

const NOW = '2026-08-18T14:31:00.000Z'
const ASSET_FILES: Record<string, Uint8Array> = {
  'asset-image': new Uint8Array(8),
  'asset-image-2': new Uint8Array(8),
  'asset-video': new Uint8Array(8),
  'asset-video-2': new Uint8Array(8),
  'asset-audio': new Uint8Array(8),
}

const originalRunFlowAuthoringIntent = useEditorStore.getState().runFlowAuthoringIntent

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.setState({ runFlowAuthoringIntent: originalRunFlowAuthoringIntent })
  useEditorStore.getState().createNewProject()
})

function createMediaEditProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '媒体编辑' },
    {
      id: 'media-image',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: '封面图',
      layout: 'content-width',
    },
    {
      id: 'media-video',
      type: 'media',
      assetId: 'asset-video',
      mediaKind: 'video',
      altText: '旧视频说明',
      caption: '旧视频题注',
      layout: 'content-width',
    },
    {
      id: 'media-audio',
      type: 'media',
      assetId: 'asset-audio',
      mediaKind: 'audio',
      caption: '音频题注',
      layout: 'content-width',
    },
  ]
  const project: CourseProjectDocument = {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-media-block-edit',
    revision: 1,
    title: 'Flow 媒体编辑',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/cover.png',
        byteLength: 8,
        width: 64,
        height: 36,
      },
      'asset-image-2': {
        id: 'asset-image-2',
        filename: 'cover-b.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/cover-b.png',
        byteLength: 8,
        width: 64,
        height: 36,
      },
      'asset-video': {
        id: 'asset-video',
        filename: 'lesson.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/lesson.mp4',
        byteLength: 8,
        width: 1280,
        height: 720,
      },
      'asset-video-2': {
        id: 'asset-video-2',
        filename: 'lesson-b.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'assets/lesson-b.mp4',
        byteLength: 8,
        width: 1920,
        height: 1080,
      },
      'asset-audio': {
        id: 'asset-audio',
        filename: 'voice.mp3',
        mimeType: 'audio/mpeg',
        kind: 'audio',
        path: 'assets/voice.mp3',
        byteLength: 8,
      },
    },
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
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
    locations: [{
      id: 'h1',
      label: '媒体编辑',
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
      surfaceLayerItems: [],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

function mediaBlock(document: CourseProjectDocument, id = 'media-image'): FlowMediaBlock {
  const surface = document.surfaces.find((candidate) => candidate.id === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
  const block = surface.blocks.find((candidate) => candidate.id === id)
  if (!block || block.type !== 'media') throw new Error(`expected media ${id}`)
  return block
}

function storeFlowDocument(): CourseProjectDocument {
  const document = useEditorStore.getState().flowSession?.history.present
  if (!document) throw new Error('expected Flow store document')
  return document
}

function storeFlowBlockOrder(): string[] {
  const surface = storeFlowDocument().surfaces.find((candidate) => candidate.id === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
  return surface.blocks.map((block) => block.id)
}

function selectStoreMedia(blockId: string): void {
  const document = storeFlowDocument()
  const flow = useEditorStore.getState().flowSession
  if (!flow) throw new Error('expected Flow session')
  useEditorStore.getState().applyFlowSelection(
    selectFlowEditorBlock(document, flow.selection.locationId, blockId),
  )
}

function commitPropertyInput(label: string, value: string): void {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

describe('Flow media block field and asset replacement commands', () => {
  it('routes a stale Properties delete through the Store boundary without overwriting newer content', () => {
    useEditorStore.getState().loadCourseProject(createMediaEditProject(), null, ASSET_FILES)
    selectStoreMedia('media-image')
    let documentAfterConcurrentWrite: CourseProjectDocument | null = null
    let historyAfterConcurrentWrite: readonly unknown[] | null = null
    let selectionAfterConcurrentWrite = useEditorStore.getState().flowSession!.selection
    const deleteThroughConcurrentWrite = vi.fn((
      ...args: Parameters<typeof originalRunFlowAuthoringIntent>
    ) => {
      const flow = useEditorStore.getState().flowSession!
      const videoSelection = selectFlowEditorBlock(
        flow.history.present,
        flow.selection.locationId,
        'media-video',
      )
      useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(
        flow.history.present,
        flowBlockTargetFromSelection(flow.history.present, videoSelection),
        { caption: '并发保留的新内容' },
        { expectedRevision: flow.history.present.revision },
      ))
      documentAfterConcurrentWrite = storeFlowDocument()
      historyAfterConcurrentWrite = useEditorStore.getState().flowSession!.history.past
      selectionAfterConcurrentWrite = useEditorStore.getState().flowSession!.selection
      return originalRunFlowAuthoringIntent(...args)
    })
    useEditorStore.setState({ runFlowAuthoringIntent: deleteThroughConcurrentWrite })
    render(createElement(PropertiesTab, { onReplaceImage: () => undefined }))

    fireEvent.click(screen.getByTestId('flow-delete-media-block'))

    expect(deleteThroughConcurrentWrite).toHaveBeenCalledOnce()
    expect(storeFlowDocument()).toBe(documentAfterConcurrentWrite)
    expect(useEditorStore.getState().flowSession!.history.past).toBe(historyAfterConcurrentWrite)
    expect(useEditorStore.getState().flowSession!.selection).toBe(selectionAfterConcurrentWrite)
    expect(mediaBlock(storeFlowDocument(), 'media-image')).toBeDefined()
    expect(mediaBlock(storeFlowDocument(), 'media-video').caption).toBe('并发保留的新内容')
    expect(useEditorStore.getState().errorMessage).toBe(
      COURSE_AUTHORING_TARGET_REJECTION_REASONS['revision-conflict'],
    )
  })

  it('edits and persists current-contract video fields through Store and Properties', () => {
    useEditorStore.getState().loadCourseProject(createMediaEditProject(), null, ASSET_FILES)
    selectStoreMedia('media-video')
    render(createElement(PropertiesTab, { onReplaceImage: () => undefined }))

    expect(screen.getByTestId('flow-media-properties')).toHaveTextContent('视频 · lesson.mp4')
    expect(screen.getByLabelText('替代文本')).toHaveValue('旧视频说明')
    const replacement = screen.getByRole('combobox', { name: '替换素材' }) as HTMLSelectElement
    expect(Array.from(replacement.options, (option) => option.value)).toEqual([
      'asset-video',
      'asset-video-2',
    ])
    expect(Array.from(replacement.options, (option) => option.value)).not.toContain('asset-audio')

    commitPropertyInput('替代文本', '完整视频说明')
    commitPropertyInput('题注', '新视频题注')
    fireEvent.change(screen.getByRole('combobox', { name: '版式' }), {
      target: { value: 'full-width' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: '文字环绕' }), {
      target: { value: 'right' },
    })

    expect(storeFlowBlockOrder()).toEqual(['h1', 'media-image', 'media-video', 'media-audio'])
    fireEvent.click(screen.getByTestId('flow-block-move-up'))
    expect(storeFlowBlockOrder()).toEqual(['h1', 'media-video', 'media-image', 'media-audio'])

    const historyBeforeReplacement = useEditorStore.getState().flowSession!.history.past.length
    fireEvent.change(screen.getByRole('combobox', { name: '替换素材' }), {
      target: { value: 'asset-video-2' },
    })
    expect(useEditorStore.getState().flowSession!.history.past).toHaveLength(historyBeforeReplacement + 1)

    let video = mediaBlock(storeFlowDocument(), 'media-video')
    expect(video).toMatchObject({
      assetId: 'asset-video-2',
      mediaKind: 'video',
      altText: '完整视频说明',
      caption: '新视频题注',
      layout: 'full-width',
      wrap: 'right',
    })
    for (const advancedField of ['poster', 'autoplay', 'loop', 'start', 'end', 'crop', 'objectFit']) {
      expect(Object.prototype.hasOwnProperty.call(video, advancedField)).toBe(false)
    }

    const liveFlow = useEditorStore.getState().flowSession!
    const wrongKind = replaceFlowMediaBlockAsset(
      liveFlow.history.present,
      flowBlockTargetFromSelection(liveFlow.history.present, liveFlow.selection),
      'asset-audio',
      { expectedRevision: liveFlow.history.present.revision },
    )
    const historyBeforeWrongKind = liveFlow.history.past.length
    expect(useEditorStore.getState().applyFlowCommand(wrongKind).ok).toBe(false)
    expect(useEditorStore.getState().flowSession!.history.past).toHaveLength(historyBeforeWrongKind)
    expect(mediaBlock(storeFlowDocument(), 'media-video')).toEqual(video)

    const archive = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(archive).toBeTruthy()

    useEditorStore.getState().undo()
    video = mediaBlock(storeFlowDocument(), 'media-video')
    expect(video.assetId).toBe('asset-video')
    expect(video).toMatchObject({
      altText: '完整视频说明',
      caption: '新视频题注',
      layout: 'full-width',
      wrap: 'right',
    })
    expect(storeFlowBlockOrder()).toEqual(['h1', 'media-video', 'media-image', 'media-audio'])

    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(archive!)).toBe(true)
    expect(mediaBlock(storeFlowDocument(), 'media-video')).toMatchObject({
      assetId: 'asset-video-2',
      altText: '完整视频说明',
      caption: '新视频题注',
      layout: 'full-width',
      wrap: 'right',
    })
    expect(storeFlowBlockOrder()).toEqual(['h1', 'media-video', 'media-image', 'media-audio'])

    selectStoreMedia('media-audio')
    cleanup()
    render(createElement(PropertiesTab, { onReplaceImage: () => undefined }))
    expect(screen.queryByLabelText('替代文本')).toBeNull()
    expect(screen.getByLabelText('题注')).toHaveValue('音频题注')
  })

  it('updates alt, caption and layout on the current media block', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const result = updateFlowEditorBlock(
      project,
      flowBlockTargetFromSelection(project, selection),
      { altText: '新说明', caption: '新题注', layout: 'full-width' },
    )
    expect(result.ok).toBe(true)
    const next = mediaBlock(result.nextDocument!)
    expect(next.altText).toBe('新说明')
    expect(next.caption).toBe('新题注')
    expect(next.layout).toBe('full-width')
    expect(next.assetId).toBe('asset-image')
  })

  it('replaces assetId with a same-kind library asset and refuses a different kind', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const target = flowBlockTargetFromSelection(project, selection)
    const replaced = replaceFlowMediaBlockAsset(project, target, 'asset-image-2')
    expect(replaced.ok).toBe(true)
    const next = mediaBlock(replaced.nextDocument!)
    expect(next.assetId).toBe('asset-image-2')
    expect(next.layout).toBe('content-width')
    expect(next.caption).toBe('封面图')

    const wrongKind = replaceFlowMediaBlockAsset(replaced.nextDocument!, target, 'asset-audio')
    expect(wrongKind.ok).toBe(false)
    expect(wrongKind.reason).toContain('类型')
    expect(mediaBlock(replaced.nextDocument!).assetId).toBe('asset-image-2')
  })

  it('refuses to treat a heading as a media asset replacement target', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'h1')
    const result = replaceFlowMediaBlockAsset(
      project,
      flowBlockTargetFromSelection(project, selection),
      'asset-image-2',
    )
    expect(result.ok).toBe(false)
    expect(result.nextDocument).toBeUndefined()
  })

  it('deletes the selected media block through the existing Flow delete command', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const deleted = executeFlowEditorCommand(project, selection, { name: 'delete' })
    expect(deleted.ok).toBe(true)
    const surface = deleted.nextDocument!.surfaces.find((candidate) => candidate.id === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
    expect(surface.blocks.some((block) => block.id === 'media-image')).toBe(false)
    expect(surface.blocks.some((block) => block.id === 'h1')).toBe(true)
  })

  it('imports and replaces a media block asset from disk metadata', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const target = flowBlockTargetFromSelection(project, selection)
    const diskAsset: AssetMeta = {
      id: 'asset-from-disk',
      filename: 'disk.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/asset-from-disk.png',
      byteLength: 4,
      width: 32,
      height: 32,
    }
    const result = importAndReplaceFlowMediaBlock(project, target, diskAsset)
    expect(result.ok).toBe(true)
    const next = mediaBlock(result.nextDocument!)
    expect(next.assetId).toBe('asset-from-disk')
    expect(result.nextDocument!.assets['asset-from-disk']).toEqual(diskAsset)
    expect(result.nextDocument!.assets['asset-image']).toBeDefined()
    expect(next.altText).toBe('示意图')
    expect(next.caption).toBe('封面图')
    expect(next.layout).toBe('content-width')
  })

  it('refuses disk asset replacement with mismatched media kind', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const target = flowBlockTargetFromSelection(project, selection)
    const audioDiskAsset: AssetMeta = {
      id: 'asset-audio-disk',
      filename: 'disk.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/asset-audio-disk.mp3',
      byteLength: 4,
    }
    const result = importAndReplaceFlowMediaBlock(project, target, audioDiskAsset)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('类型')
    expect(result.nextDocument).toBeUndefined()
  })

  it('refuses disk asset replacement when targeting non-media block', () => {
    const project = createMediaEditProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'h1')
    const target = flowBlockTargetFromSelection(project, selection)
    const diskAsset: AssetMeta = {
      id: 'asset-from-disk',
      filename: 'disk.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/asset-from-disk.png',
      byteLength: 4,
    }
    const result = importAndReplaceFlowMediaBlock(project, target, diskAsset)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('媒体块')
    expect(result.nextDocument).toBeUndefined()
  })
})
