import type {
  NodeMotionAction,
  VideoInteractionAction,
} from '../../../shared/contracts/interaction-v1/types'
import type {
  PublishedDomInteractionSurfacePort,
} from '../../interactions/PublishedDomInteractionSurfacePort'
import type {
  PublishedInputDescriptor,
  PublishedInteractionPortResult,
  PublishedInteractionSurfacePort,
  PublishedNodeMotionContext,
  PublishedVideoActionContext,
  PublishedVideoEventKind,
} from '../../interactions/PublishedInteractionSurfacePort'
import type {
  PublishedNativeVideoHandle,
} from './publishedNativeVideoMount'

function videoListenerKey(nodeId: string, kind: PublishedVideoEventKind): string {
  return `${nodeId}::${kind}`
}

/**
 * Slide scene-local Published interaction port. Click and motion delegate to
 * the shared DOM port; video actions/events route to the Slide host-owned
 * video registry (one handle per video node, no DOM id lookup, no second
 * controller or event bus). Controller-facing video bindings survive host
 * rerenders because they are keyed by node id while the underlying handles
 * are replaced; stale work is cancelled by controller abort, port
 * deactivation and scene re-checks rather than by dropping bindings.
 */
export class PublishedSlideInteractionSurfacePort implements PublishedInteractionSurfacePort {
  readonly #dom: PublishedDomInteractionSurfacePort
  readonly #videos: ReadonlyMap<string, PublishedNativeVideoHandle>
  readonly #capture: boolean
  readonly #inputOptions: { root?: HTMLElement; describeInput?: (nodeId: string) => PublishedInputDescriptor | null }
  readonly #videoListeners = new Map<string, Set<(seconds?: number) => void>>()

  constructor(
    dom: PublishedDomInteractionSurfacePort,
    videos: ReadonlyMap<string, PublishedNativeVideoHandle>,
    options: { capture?: boolean; root?: HTMLElement; describeInput?: (nodeId: string) => PublishedInputDescriptor | null } = {},
  ) {
    this.#dom = dom
    this.#videos = videos
    this.#capture = options.capture === true
    this.#inputOptions = options
  }

  get generation(): number {
    return this.#dom.generation
  }

  get active(): boolean {
    return this.#dom.active
  }

  bindNodeClick(nodeId: string, listener: () => void): (() => void) | null {
    return this.#dom.bindNodeClick(nodeId, listener)
  }

  executeNodeMotion(
    action: NodeMotionAction,
    context: PublishedNodeMotionContext,
  ): PublishedInteractionPortResult {
    return this.#dom.executeNodeMotion(action, context)
  }

  describeInput(nodeId: string): PublishedInputDescriptor | null {
    if (this.#capture || !this.active) return null
    return this.#inputOptions.describeInput?.(nodeId) ?? null
  }

  bindInputSubmit(
    nodeId: string,
    listener: (rawValue: string) => void,
  ): (() => void) | null {
    const root = this.#inputOptions.root
    if (!root || !this.describeInput(nodeId)) return null
    const composing = new WeakSet<Element>()
    const resolve = (event: Event): HTMLInputElement | null => {
      const target = event.target as HTMLElement | null
      const input = target?.tagName === 'INPUT' ? target as HTMLInputElement
        : target?.closest('form')?.querySelector<HTMLInputElement>('input[data-input-node-id]')
      return input?.dataset.inputNodeId === nodeId && root.contains(input) ? input : null
    }
    const start = (event: Event) => { const input = resolve(event); if (input) composing.add(input) }
    const end = (event: Event) => { const input = resolve(event); if (input) composing.delete(input) }
    const key = (event: KeyboardEvent) => {
      const input = resolve(event)
      if (!input) return
      event.stopPropagation()
      if (event.key === 'Enter' && (event.isComposing || composing.has(input) || event.keyCode === 229)) event.preventDefault()
      if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); input.value = input.defaultValue }
    }
    const pointer = (event: Event) => { if (resolve(event)) event.stopPropagation() }
    const submit = (event: Event) => {
      const input = resolve(event)
      if (!input) return
      event.preventDefault()
      event.stopPropagation()
      if (!this.describeInput(nodeId) || composing.has(input)) return
      const raw = input.value
      input.defaultValue = raw
      listener(raw)
    }
    root.addEventListener('compositionstart', start)
    root.addEventListener('compositionend', end)
    root.addEventListener('keydown', key)
    root.addEventListener('pointerdown', pointer)
    root.addEventListener('click', pointer)
    root.addEventListener('submit', submit)
    return () => {
      root.removeEventListener('compositionstart', start)
      root.removeEventListener('compositionend', end)
      root.removeEventListener('keydown', key)
      root.removeEventListener('pointerdown', pointer)
      root.removeEventListener('click', pointer)
      root.removeEventListener('submit', submit)
    }
  }

  cancelActiveMotions(): void {
    this.#dom.cancelActiveMotions()
  }

  resetLocalVisibility(): void {
    this.#dom.resetLocalVisibility()
  }

  executeVideoAction(
    action: VideoInteractionAction,
    context: PublishedVideoActionContext,
  ): PublishedInteractionPortResult {
    if (this.#capture || !this.#dom.active || context.signal.aborted) return false
    const handle = this.#videos.get(action.nodeId)
    if (!handle) return false
    try {
      return handle.execute(action)
    } catch {
      return false
    }
  }

  bindVideoEvent(
    nodeId: string,
    kind: PublishedVideoEventKind,
    listener: (seconds?: number) => void,
  ): (() => void) | null {
    if (this.#capture || !this.#dom.active) return null
    if (!this.#videos.has(nodeId)) return null
    const key = videoListenerKey(nodeId, kind)
    let registrations = this.#videoListeners.get(key)
    if (!registrations) {
      registrations = new Set()
      this.#videoListeners.set(key, registrations)
    }
    registrations.add(listener)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.#videoListeners.get(key)?.delete(listener)
    }
  }

  /** Called by the Slide host when one owned video handle emits. */
  dispatchVideoEvent(nodeId: string, kind: PublishedVideoEventKind, seconds?: number): void {
    if (this.#capture || !this.#dom.active) return
    const registrations = this.#videoListeners.get(videoListenerKey(nodeId, kind))
    if (!registrations || registrations.size === 0) return
    for (const listener of [...registrations]) {
      try {
        listener(seconds)
      } catch {
        // A controller callback is isolated from media event dispatch.
      }
    }
  }

  clearVideoListeners(): void {
    this.#videoListeners.clear()
  }
}
