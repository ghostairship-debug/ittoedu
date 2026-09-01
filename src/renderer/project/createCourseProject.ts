import { nanoid } from 'nanoid'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type GlobalLayerEntry,
} from '@/shared/courseProjectTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import {
  createTeacherControllerNode,
  type CreateProjectOptions,
  type IdFactory,
} from './createProject'

const DEFAULT_FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'

function nextId(prefix: string, explicitId: string | undefined, idFactory: IdFactory): string {
  return explicitId ?? `${prefix}_${idFactory()}`
}

function toIsoString(value: string | Date | undefined): string {
  if (value === undefined) return new Date().toISOString()
  return typeof value === 'string' ? value : value.toISOString()
}

function initialSlidePresentation() {
  return {
    initialStateId: 'state_initial',
    thumbnailStateId: 'state_initial',
    states: [{ id: 'state_initial', name: '初始', layerItemOverrides: {} }],
  }
}

/**
 * Default Course Project V9 factory.
 *
 * Builds a valid V9 Slide document (including the default teacher controller)
 * directly. Callers must hold the returned Course Project as the session truth.
 */
export function createBlankCourseProject(
  options: CreateProjectOptions = {},
): CourseProjectDocument {
  const idFactory = options.idFactory ?? nanoid
  const timestamp = toIsoString(options.now)
  const includeDefaultController = options.includeDefaultController ?? true
  if (options.includeDefaultController === false && options.controls === undefined) {
    throw new Error('不包含默认教师控制器时必须显式设置 controls')
  }
  const controls = options.controls ?? 'canvas'
  if (controls === 'canvas' && !includeDefaultController) {
    throw new Error('画布控制模式必须包含默认教师控制器')
  }

  const projectId = nextId('project', options.id, idFactory)
  const sceneId = nextId('scene', undefined, idFactory)
  const slideSurfaceId = `slide:${projectId}`
  const title = options.title ?? '未命名课件'
  const controller = includeDefaultController
    ? createTeacherControllerNode({
        idFactory,
        playbackInitialVisibility: controls === 'canvas' ? 'inherit' : 'hidden',
      })
    : null
  const globalLayerItems: GlobalLayerEntry[] = controller
    ? [{
        item: sceneNodeToCourseLayerItem(controller, 1),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'overlay',
      }]
    : []

  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: projectId,
    revision: 0,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    assets: {},
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: DEFAULT_FONT_FAMILY,
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
        { id: 'accent', label: '强调', color: '#2563eb' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: {
          music: 1,
          narration: 1,
          sfx: 1,
          ui: 1,
          video: 1,
        },
        sounds: {},
        narrationDucking: {
          enabled: true,
          musicVolume: 0.3,
          fadeMs: 250,
        },
      },
    },
    playback: {
      controls,
      keyboardNavigation: true,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    locations: [{
      id: sceneId,
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: slideSurfaceId,
      sceneId,
    }],
    startLocationId: sceneId,
    globalLayerItems,
    globalInteractions: [],
    surfaces: [{
      id: slideSurfaceId,
      title,
      type: 'slide',
      canvas: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      surfaceLayerItems: [],
      scenes: [{
        id: sceneId,
        name: '场景 1',
        backgroundColor: '#ffffff',
        backgroundAssetId: null,
        layerItems: [],
        presentation: initialSlidePresentation(),
        interactions: [],
      }],
    }],
  })
}

export function createCourseProject(
  options: CreateProjectOptions = {},
): CourseProjectDocument {
  return createBlankCourseProject(options)
}
