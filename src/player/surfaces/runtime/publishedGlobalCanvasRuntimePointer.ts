import type {
  PublishedLayerItem,
  PublishedRuntimeLayerItem,
} from '../../../shared/publishedCourseTypes'

type GlobalRuntimeState = 'playback' | 'fallback'
type RuntimePointerTarget = HTMLElement | SVGElement

export function isPublishedGlobalCanvasRuntimePointerItem(
  item: PublishedLayerItem,
): item is PublishedRuntimeLayerItem {
  return item.kind === 'runtime'
    && item.runtime.enabled
    && item.runtime.protocol === 'canvas-runtime'
    && item.runtime.runtimeApiVersion === 2
}

function applyPointerState(target: RuntimePointerTarget): void {
  const playback = target.dataset.globalRuntimeState === 'playback'
  const authoredHit = target.dataset.publishedGlobalRuntimeHitPolicy === 'auto'
  const interactionVisible = target.dataset.interactionVisibility !== 'hidden'
  target.style.pointerEvents = playback && authoredHit && interactionVisible
    ? 'auto'
    : 'none'
}

function initializePointerState(
  target: RuntimePointerTarget,
  hitPolicy: PublishedRuntimeLayerItem['hitPolicy'],
  authoredVisible: boolean,
): void {
  target.dataset.publishedGlobalRuntimeHitPolicy = hitPolicy
  target.dataset.interactionVisibility ??= authoredVisible ? 'visible' : 'hidden'
}

/** Compose owner playback/fallback with authored hit and Interaction visibility. */
export function setPublishedGlobalCanvasRuntimeState(
  target: RuntimePointerTarget,
  state: GlobalRuntimeState,
  item: PublishedRuntimeLayerItem,
): void {
  initializePointerState(
    target,
    item.hitPolicy,
    item.playbackInitialVisibility !== 'hidden',
  )
  target.dataset.globalRuntimeState = state
  applyPointerState(target)
}

/** Host-side Interaction update for the same stable global Runtime wrapper. */
export function setPublishedGlobalCanvasRuntimeInteractionVisibility(
  target: RuntimePointerTarget,
  item: PublishedRuntimeLayerItem,
  visible: boolean,
): void {
  initializePointerState(
    target,
    item.hitPolicy,
    item.playbackInitialVisibility !== 'hidden',
  )
  target.dataset.interactionVisibility = visible ? 'visible' : 'hidden'
  applyPointerState(target)
}
