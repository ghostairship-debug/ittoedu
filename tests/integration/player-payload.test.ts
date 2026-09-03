import { describe, expect, it } from 'vitest'
import {
  PLAYER_V2_ENTRY_CORRUPT_ERROR,
  PLAYER_V2_ENTRY_UNSUPPORTED_ERROR,
  parsePublishedCourseV2Entry,
} from '@/player/index'
import { PUBLISHED_LESSON_FORMAT, PUBLISHED_LESSON_VERSION } from '@/shared/publishedLessonTypes'

describe('Player payload is Published V2 only', () => {
  it('fail-louds retired object payloads, V7, encoded payloads, and corrupt JSON', () => {
    expect(() => parsePublishedCourseV2Entry({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    expect(() => parsePublishedCourseV2Entry({
      project: { schemaVersion: 7, scenes: [] },
      assets: {},
      components: {},
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    expect(() => parsePublishedCourseV2Entry({
      format: PUBLISHED_LESSON_FORMAT,
      formatVersion: PUBLISHED_LESSON_VERSION,
    })).toThrow(PLAYER_V2_ENTRY_UNSUPPORTED_ERROR)

    expect(() => parsePublishedCourseV2Entry('not-valid-%%%')).toThrow(
      PLAYER_V2_ENTRY_UNSUPPORTED_ERROR,
    )
    expect(() => parsePublishedCourseV2Entry('{')).toThrow(PLAYER_V2_ENTRY_CORRUPT_ERROR)
  })
})
