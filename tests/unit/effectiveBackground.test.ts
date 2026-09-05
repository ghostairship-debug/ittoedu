import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EFFECTIVE_BACKGROUND_COLOR,
  resolveEffectiveBackground,
  type CourseBackgroundFields,
  type EffectiveBackground,
  type FlowSurfaceBackgroundFields,
  type SlideNamedStateBackgroundFields,
  type SlideSceneBackgroundFields,
  type SlideSurfaceBackgroundFields,
  type SpatialSurfaceBackgroundFields,
} from '@/shared/effectiveBackground'

const WHITE = DEFAULT_EFFECTIVE_BACKGROUND_COLOR

const OWN_COURSE: CourseBackgroundFields = {
  backgroundColor: '#101010',
  backgroundAssetId: 'course-asset',
}

const INHERIT_COURSE_RESULT: EffectiveBackground = {
  color: '#101010',
  assetId: 'course-asset',
  sourceOwner: 'course',
}

describe('resolveEffectiveBackground: course (chain root, no mode)', () => {
  it('defaults an all-omitted course to white with no asset (legacy V9 project)', () => {
    expect(resolveEffectiveBackground({ owner: 'course', course: {} }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'course' })
  })

  it('uses the course color and asset when both are set', () => {
    expect(resolveEffectiveBackground({ owner: 'course', course: OWN_COURSE }))
      .toEqual(INHERIT_COURSE_RESULT)
  })

  it('treats an explicit null asset as cleared, distinct from omission', () => {
    expect(resolveEffectiveBackground({
      owner: 'course',
      course: { backgroundColor: '#112233', backgroundAssetId: null },
    })).toEqual({ color: '#112233', assetId: null, sourceOwner: 'course' })
  })

  it('defaults only the omitted half when color is set but asset is not', () => {
    expect(resolveEffectiveBackground({
      owner: 'course',
      course: { backgroundColor: '#445566' },
    })).toEqual({ color: '#445566', assetId: null, sourceOwner: 'course' })
  })
})

describe('resolveEffectiveBackground: Slide surface (mode defaults to inherit)', () => {
  it('defaults an omitted mode to inherit and follows Course', () => {
    const surface: SlideSurfaceBackgroundFields = {}
    expect(resolveEffectiveBackground({ owner: 'slide-surface', course: OWN_COURSE, surface }))
      .toEqual(INHERIT_COURSE_RESULT)
  })

  it('follows Course under an explicit inherit mode, ignoring dormant own fields', () => {
    const surface: SlideSurfaceBackgroundFields = {
      backgroundMode: 'inherit',
      backgroundColor: '#efefef',
      backgroundAssetId: 'dormant-surface-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'slide-surface', course: OWN_COURSE, surface }))
      .toEqual(INHERIT_COURSE_RESULT)
  })

  it('uses its own white/null defaults under own mode when own fields are omitted', () => {
    const surface: SlideSurfaceBackgroundFields = { backgroundMode: 'own' }
    expect(resolveEffectiveBackground({ owner: 'slide-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'slide-surface' })
  })

  it('uses its own explicit color/asset under own mode', () => {
    const surface: SlideSurfaceBackgroundFields = {
      backgroundMode: 'own',
      backgroundColor: '#efefef',
      backgroundAssetId: 'surface-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'slide-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#efefef', assetId: 'surface-asset', sourceOwner: 'slide-surface' })
  })

  it('treats an own surface with an explicit null asset as cleared', () => {
    const surface: SlideSurfaceBackgroundFields = {
      backgroundMode: 'own',
      backgroundColor: '#efefef',
      backgroundAssetId: null,
    }
    expect(resolveEffectiveBackground({ owner: 'slide-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#efefef', assetId: null, sourceOwner: 'slide-surface' })
  })
})

describe('resolveEffectiveBackground: Slide scene (mode defaults to own; color always required)', () => {
  const inheritSurface: SlideSurfaceBackgroundFields = {}
  const ownSurface: SlideSurfaceBackgroundFields = {
    backgroundMode: 'own',
    backgroundColor: '#efefef',
    backgroundAssetId: 'surface-asset',
  }

  it('defaults an omitted mode to own and uses the required color plus a defaulted null asset (legacy scene)', () => {
    const scene: SlideSceneBackgroundFields = { backgroundColor: '#223344' }
    expect(resolveEffectiveBackground({
      owner: 'slide-scene', course: OWN_COURSE, surface: inheritSurface, scene,
    })).toEqual({ color: '#223344', assetId: null, sourceOwner: 'slide-scene' })
  })

  it('uses its own color and asset under explicit own mode', () => {
    const scene: SlideSceneBackgroundFields = {
      backgroundMode: 'own',
      backgroundColor: '#223344',
      backgroundAssetId: 'scene-asset',
    }
    expect(resolveEffectiveBackground({
      owner: 'slide-scene', course: OWN_COURSE, surface: inheritSurface, scene,
    })).toEqual({ color: '#223344', assetId: 'scene-asset', sourceOwner: 'slide-scene' })
  })

  it('forwards a Course-inheriting surface result under inherit mode', () => {
    const scene: SlideSceneBackgroundFields = { backgroundMode: 'inherit', backgroundColor: '#223344' }
    expect(resolveEffectiveBackground({
      owner: 'slide-scene', course: OWN_COURSE, surface: inheritSurface, scene,
    })).toEqual(INHERIT_COURSE_RESULT)
  })

  it('forwards an own-surface result under inherit mode, dormant scene fields ignored', () => {
    const scene: SlideSceneBackgroundFields = {
      backgroundMode: 'inherit',
      backgroundColor: '#dormant-would-be-invalid-but-unused',
      backgroundAssetId: 'dormant-scene-asset',
    }
    expect(resolveEffectiveBackground({
      owner: 'slide-scene', course: OWN_COURSE, surface: ownSurface, scene,
    })).toEqual({ color: '#efefef', assetId: 'surface-asset', sourceOwner: 'slide-surface' })
  })
})

describe('resolveEffectiveBackground: Slide named state (no mode; independent per-field override)', () => {
  const surface: SlideSurfaceBackgroundFields = {}
  const scene: SlideSceneBackgroundFields = {
    backgroundMode: 'own',
    backgroundColor: '#223344',
    backgroundAssetId: 'scene-asset',
  }
  const sceneResult: EffectiveBackground = { color: '#223344', assetId: 'scene-asset', sourceOwner: 'slide-scene' }

  it('inherits the full scene result when both overrides are undefined (legacy state)', () => {
    const state: SlideNamedStateBackgroundFields = {}
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual(sceneResult)
  })

  it('overrides only color, inheriting the scene asset', () => {
    const state: SlideNamedStateBackgroundFields = { backgroundColor: '#998877' }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#998877', assetId: 'scene-asset', sourceOwner: 'slide-state' })
  })

  it('overrides only asset with a string id, inheriting the scene color', () => {
    const state: SlideNamedStateBackgroundFields = { backgroundAssetId: 'state-asset' }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#223344', assetId: 'state-asset', sourceOwner: 'slide-state' })
  })

  it('overrides only asset with an explicit null, distinct from omission, inheriting the scene color', () => {
    const state: SlideNamedStateBackgroundFields = { backgroundAssetId: null }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#223344', assetId: null, sourceOwner: 'slide-state' })
  })

  it('overrides both color and asset', () => {
    const state: SlideNamedStateBackgroundFields = { backgroundColor: '#998877', backgroundAssetId: 'state-asset' }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#998877', assetId: 'state-asset', sourceOwner: 'slide-state' })
  })

  it('overrides both color and an explicit null asset', () => {
    const state: SlideNamedStateBackgroundFields = { backgroundColor: '#998877', backgroundAssetId: null }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#998877', assetId: null, sourceOwner: 'slide-state' })
  })

  it('propagates the deeper sourceOwner through an inheriting scene when the state does not override', () => {
    const inheritingScene: SlideSceneBackgroundFields = { backgroundMode: 'inherit', backgroundColor: '#unused' }
    const state: SlideNamedStateBackgroundFields = {}
    expect(resolveEffectiveBackground({
      owner: 'slide-state', course: OWN_COURSE, surface, scene: inheritingScene, state,
    })).toEqual(INHERIT_COURSE_RESULT)
  })
})

describe('resolveEffectiveBackground: Flow surface (mode defaults to own, unlike Slide surface)', () => {
  it('defaults an omitted mode to own and defaults omitted own fields to white/null (legacy Flow surface)', () => {
    const surface: FlowSurfaceBackgroundFields = {}
    expect(resolveEffectiveBackground({ owner: 'flow-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'flow-surface' })
  })

  it('defaults an omitted mode to own and keeps an explicit legacy color', () => {
    const surface: FlowSurfaceBackgroundFields = { backgroundColor: '#fffbeb' }
    expect(resolveEffectiveBackground({ owner: 'flow-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#fffbeb', assetId: null, sourceOwner: 'flow-surface' })
  })

  it('uses its own explicit color/asset under explicit own mode', () => {
    const surface: FlowSurfaceBackgroundFields = {
      backgroundMode: 'own',
      backgroundColor: '#fffbeb',
      backgroundAssetId: 'flow-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'flow-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#fffbeb', assetId: 'flow-asset', sourceOwner: 'flow-surface' })
  })

  it('follows Course under explicit inherit mode, ignoring dormant own fields', () => {
    const surface: FlowSurfaceBackgroundFields = {
      backgroundMode: 'inherit',
      backgroundColor: '#fffbeb',
      backgroundAssetId: 'dormant-flow-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'flow-surface', course: OWN_COURSE, surface }))
      .toEqual(INHERIT_COURSE_RESULT)
  })
})

describe('resolveEffectiveBackground: Spatial surface (mode defaults to own, unlike Slide surface)', () => {
  it('defaults an omitted mode to own and defaults omitted own fields to white/null (legacy Spatial surface)', () => {
    const surface: SpatialSurfaceBackgroundFields = {}
    expect(resolveEffectiveBackground({ owner: 'spatial-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'spatial-surface' })
  })

  it('defaults an omitted mode to own and keeps an explicit legacy color', () => {
    const surface: SpatialSurfaceBackgroundFields = { backgroundColor: '#f1f5f9' }
    expect(resolveEffectiveBackground({ owner: 'spatial-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#f1f5f9', assetId: null, sourceOwner: 'spatial-surface' })
  })

  it('uses its own explicit color/asset under explicit own mode', () => {
    const surface: SpatialSurfaceBackgroundFields = {
      backgroundMode: 'own',
      backgroundColor: '#f1f5f9',
      backgroundAssetId: 'spatial-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'spatial-surface', course: OWN_COURSE, surface }))
      .toEqual({ color: '#f1f5f9', assetId: 'spatial-asset', sourceOwner: 'spatial-surface' })
  })

  it('follows Course under explicit inherit mode, ignoring dormant own fields', () => {
    const surface: SpatialSurfaceBackgroundFields = {
      backgroundMode: 'inherit',
      backgroundColor: '#f1f5f9',
      backgroundAssetId: 'dormant-spatial-asset',
    }
    expect(resolveEffectiveBackground({ owner: 'spatial-surface', course: OWN_COURSE, surface }))
      .toEqual(INHERIT_COURSE_RESULT)
  })
})

describe('resolveEffectiveBackground: end-to-end chain composition', () => {
  it('resolves a fully legacy V9 project (no new fields anywhere) exactly like 1.1.1: white Course, inherited Slide surface, own Scene, passthrough State', () => {
    const course: CourseBackgroundFields = {}
    const surface: SlideSurfaceBackgroundFields = {}
    const scene: SlideSceneBackgroundFields = { backgroundColor: '#ffffff' }
    const state: SlideNamedStateBackgroundFields = {}

    expect(resolveEffectiveBackground({ owner: 'slide-surface', course, surface }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'course' })
    expect(resolveEffectiveBackground({ owner: 'slide-scene', course, surface, scene }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'slide-scene' })
    expect(resolveEffectiveBackground({ owner: 'slide-state', course, surface, scene, state }))
      .toEqual({ color: WHITE, assetId: null, sourceOwner: 'slide-scene' })
  })

  it('carries an own Course background down through two levels of inherit to Slide scene', () => {
    const surface: SlideSurfaceBackgroundFields = { backgroundMode: 'inherit' }
    const scene: SlideSceneBackgroundFields = { backgroundMode: 'inherit', backgroundColor: '#unused' }
    expect(resolveEffectiveBackground({ owner: 'slide-scene', course: OWN_COURSE, surface, scene }))
      .toEqual(INHERIT_COURSE_RESULT)
  })

  it('lets a Named state color override sit on top of an inherited-to-Course scene result', () => {
    const surface: SlideSurfaceBackgroundFields = { backgroundMode: 'inherit' }
    const scene: SlideSceneBackgroundFields = { backgroundMode: 'inherit', backgroundColor: '#unused' }
    const state: SlideNamedStateBackgroundFields = { backgroundColor: '#abcdef' }
    expect(resolveEffectiveBackground({ owner: 'slide-state', course: OWN_COURSE, surface, scene, state }))
      .toEqual({ color: '#abcdef', assetId: 'course-asset', sourceOwner: 'slide-state' })
  })

  it('never shares state between independent calls (pure function, no caching leakage)', () => {
    const first = resolveEffectiveBackground({
      owner: 'flow-surface',
      course: OWN_COURSE,
      surface: { backgroundMode: 'own', backgroundColor: '#111111', backgroundAssetId: 'a' },
    })
    const second = resolveEffectiveBackground({
      owner: 'flow-surface',
      course: OWN_COURSE,
      surface: { backgroundMode: 'own', backgroundColor: '#222222', backgroundAssetId: 'b' },
    })
    expect(first).toEqual({ color: '#111111', assetId: 'a', sourceOwner: 'flow-surface' })
    expect(second).toEqual({ color: '#222222', assetId: 'b', sourceOwner: 'flow-surface' })
  })
})
