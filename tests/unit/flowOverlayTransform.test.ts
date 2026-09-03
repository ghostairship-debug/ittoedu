import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { transformFlowOverlayFrame } from '@/renderer/course/flowSharedAuthoringAdapters'

const NOW = '2026-08-18T12:00:00.000Z'

function flowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '标题' },
  ]
  const project: CourseProjectDocument = {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-overlay-transform',
    revision: 1,
    title: 'Flow overlay',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
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
      label: '标题',
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
          x: 40,
          y: 80,
          width: 160,
          height: 48,
        }), 20),
        visibility: { mode: 'all', locationIds: [] },
      }],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

describe('transformFlowOverlayFrame', () => {
  it('writes overlay frame once and no-ops an unchanged pointerup', () => {
    const project = flowProject()
    const selection = selectFlowOverlay(project, 'h1', ['overlay-text'], 'page')
    const moved = transformFlowOverlayFrame(project, selection, {
      x: 80,
      y: 120,
      width: 160,
      height: 48,
    }, { expectedRevision: 1, now: NOW })
    expect(moved.ok).toBe(true)
    expect(moved.historyEntry).toBe(true)
    const item = moved.nextDocument!.surfaces[0]
    const overlay = item && item.type === 'flow' ? item.surfaceLayerItems[0]!.item : null
    expect(overlay?.frame).toMatchObject({ x: 80, y: 120, width: 160, height: 48 })

    const again = transformFlowOverlayFrame(moved.nextDocument!, selection, {
      x: 80,
      y: 120,
      width: 160,
      height: 48,
    }, { expectedRevision: moved.nextDocument!.revision, now: NOW })
    expect(again.ok).toBe(true)
    expect(again.historyEntry).toBe(false)
  })
})
