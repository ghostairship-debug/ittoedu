import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type NativeLayerItem,
  type ScopedLayerItem,
} from '../../shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { createTeacherControllerNode } from '../project/nativeNodeFactories'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '../course/slideAuthoringBackend'
import { useEditorStore } from '../store/editorStore'

/**
 * Dev-only V9 Slide candidate inject for a dedicated Electron smoke session.
 * Must stay inert unless Vite compiled `VITE_V9_CANDIDATE_SMOKE=1`.
 * Not a teacher-visible control, URL switch, or default backend change.
 */
const NOW = '2026-08-17T15:00:00.000Z'

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

function nativeText(
  layerItemId: string,
  order: number,
  text: string,
): NativeLayerItem {
  return {
    layerItemId,
    label: text,
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

function scoped(
  item: NativeLayerItem,
  visibility: ScopedLayerItem['visibility'] = { mode: 'all', locationIds: [] },
): ScopedLayerItem {
  return { item, visibility }
}

function r3CandidateSmokeFixture(): CourseProjectDocument {
  const controller = sceneNodeToCourseLayerItem(
    createTeacherControllerNode({ id: 'teacher-controller-main' }),
    90,
  )
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'r3z-layers',
    revision: 1,
    title: 'R3-Z layers',
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
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [
      scoped(nativeText('global-banner', 0, '全课横幅')),
      scoped(controller as NativeLayerItem),
    ],
    globalInteractions: [],
    locations: [
      {
        id: 'location-scene-1',
        label: '场景 1',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-1',
      },
      {
        id: 'location-scene-2',
        label: '场景 2',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-2',
      },
      {
        id: 'location-scene-3',
        label: '场景 3',
        kind: 'slide-scene',
        surfaceId: 'surface-slide',
        sceneId: 'scene-3',
      },
    ],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [
        {
          id: 'scene-1',
          name: '场景 1',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title', 20, '本页标题')],
          interactions: [],
        },
        {
          id: 'scene-2',
          name: '场景 2',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-2', 20, '第二页标题')],
          interactions: [],
        },
        {
          id: 'scene-3',
          name: '场景 3',
          backgroundColor: '#ffffff',
          layerItems: [nativeText('slide-title-3', 20, '第三页标题')],
          interactions: [],
        },
      ],
    }],
  })
}

export function injectV9CandidateSmoke(): void {
  if (import.meta.env.VITE_V9_CANDIDATE_SMOKE !== '1') return
  const backend = createSlideAuthoringBackend(
    openSlideAuthoringSession(r3CandidateSmokeFixture()),
  )
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
}
