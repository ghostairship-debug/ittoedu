import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-17T00:00:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'course-core',
    revision: 0,
    title: '最小合同',
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
      controls: 'none',
      keyboardNavigation: true,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function minimalSlideProject(): CourseProjectDocument {
  return {
    ...courseShell(),
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
  }
}

describe('CourseProjectDocument top-level fields audit (T1-C)', () => {
  it('keeps the Course Project schema version fixed at 9', () => {
    expect(COURSE_PROJECT_SCHEMA_VERSION).toBe(9)
  })

  it('successfully parses a minimal legal V9 course project', () => {
    const project = minimalSlideProject()
    const result = courseProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(true)
  })

  it('rejects an object with schemaVersion: 8', () => {
    const project = {
      ...minimalSlideProject(),
      schemaVersion: 8,
    }
    const result = courseProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(false)
  })

  it('rejects extra top-level field projectMode due to strict validation', () => {
    const project = {
      ...minimalSlideProject(),
      projectMode: 'slide',
    }
    const result = courseProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(false)
  })

  it('rejects extra top-level field aiHandoff due to strict validation', () => {
    const project = {
      ...minimalSlideProject(),
      aiHandoff: {
        status: 'pending',
      },
    }
    const result = courseProjectDocumentSchema.safeParse(project)
    expect(result.success).toBe(false)
  })
})
