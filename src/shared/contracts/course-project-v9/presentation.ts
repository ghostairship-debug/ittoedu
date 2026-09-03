import type {
  SlidePresentation,
  SlideSceneDocument,
} from './types'

export const DEFAULT_SLIDE_PRESENTATION_STATE_ID = 'state_initial'

/** Canonical fallback used when a V9 Slide scene has no authored presentation. */
export function createDefaultSlidePresentation(): SlidePresentation {
  return {
    initialStateId: DEFAULT_SLIDE_PRESENTATION_STATE_ID,
    thumbnailStateId: DEFAULT_SLIDE_PRESENTATION_STATE_ID,
    states: [{
      id: DEFAULT_SLIDE_PRESENTATION_STATE_ID,
      name: '初始',
      layerItemOverrides: {},
    }],
  }
}

/**
 * Returns the authored V9 presentation, or a detached canonical fallback.
 * Parsed V9 documents already guarantee non-empty states and valid state ids;
 * the defensive id repair keeps read-only UI stable for in-memory candidates.
 */
export function ensureSlidePresentation(
  scene: Pick<SlideSceneDocument, 'presentation'>,
): SlidePresentation {
  const presentation = scene.presentation
  if (!presentation || presentation.states.length === 0) {
    return createDefaultSlidePresentation()
  }
  const stateIds = new Set(presentation.states.map((state) => state.id))
  const fallbackId = presentation.states[0]!.id
  const initialStateId = stateIds.has(presentation.initialStateId)
    ? presentation.initialStateId
    : fallbackId
  return {
    initialStateId,
    thumbnailStateId: presentation.thumbnailStateId
      && stateIds.has(presentation.thumbnailStateId)
      ? presentation.thumbnailStateId
      : initialStateId,
    states: presentation.states,
  }
}
