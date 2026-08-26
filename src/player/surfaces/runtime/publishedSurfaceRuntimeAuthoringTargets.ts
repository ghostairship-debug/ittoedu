import type {
  SurfaceRuntimeAuthoring,
  SurfaceRuntimeAuthoringRegion,
  SurfaceRuntimeBounds,
} from '../../../shared/surfaceRuntimeTypes'
import type {
  EditableTextContent,
  RuntimeAssetBinding,
} from '../../../shared/runtimeTypes'
import {
  RuntimeAuthoringTargetRegistry,
  type RuntimeAuthoringTargetsChangedHandler,
} from '../../RuntimeAuthoringTargetRegistry'

export interface PublishedRuntimeAuthoringMountOptions {
  scope: 'scene' | 'global'
  sceneId?: string
  onTargetsChanged: RuntimeAuthoringTargetsChangedHandler
}

export interface PublishedSurfaceRuntimeAuthoringTargetsOptions {
  root: HTMLElement
  width: number
  height: number
  content: EditableTextContent
  assets: Readonly<Record<string, RuntimeAssetBinding>>
  authoring: PublishedRuntimeAuthoringMountOptions
}

type TargetKind = 'text' | 'asset'

interface DeclarativeTargetRegistration {
  signature: string
  dispose: () => void
}

const DECLARATIVE_TARGET_SELECTOR = [
  '[data-courseware-content-key]',
  '[data-courseware-edit-key]',
  '[data-courseware-asset-key]',
].join(',')

function updateAuthoringTextElement(element: HTMLElement, value: string): void {
  const tagName = element.tagName.toLowerCase()
  if (tagName === 'input' || tagName === 'textarea') {
    ;(element as HTMLInputElement | HTMLTextAreaElement).value = value
    return
  }
  element.textContent = value
}

function isShadowRoot(root: Node): root is ShadowRoot {
  return root.nodeType === 11 && 'host' in root
}

function composedContains(root: HTMLElement, candidate: Element): boolean {
  let current: Node | null = candidate
  while (current) {
    if (current === root) return true
    const treeRoot: Node = current.getRootNode()
    const shadowHost: Element | null = isShadowRoot(treeRoot) ? treeRoot.host : null
    if (shadowHost) {
      current = shadowHost
      continue
    }
    current = current.parentNode
  }
  return false
}

function openDomRoots(root: HTMLElement): readonly ParentNode[] {
  const roots: ParentNode[] = [root]
  for (let index = 0; index < roots.length; index += 1) {
    for (const element of roots[index]!.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot)
    }
  }
  return roots
}

function declarativeElements(root: HTMLElement): readonly HTMLElement[] {
  const elements: HTMLElement[] = []
  for (const domRoot of openDomRoots(root)) {
    if (domRoot === root && root.matches(DECLARATIVE_TARGET_SELECTOR)) {
      elements.push(root)
    }
    elements.push(...domRoot.querySelectorAll<HTMLElement>(DECLARATIVE_TARGET_SELECTOR))
  }
  return elements
}

/** Applies a persisted Runtime text edit to matching open DOM/shadow targets. */
export function applyPublishedRuntimeAuthoringText(
  root: HTMLElement,
  key: string,
  value: string,
): boolean {
  let updated = false
  for (const current of openDomRoots(root)) {
    const elements: readonly HTMLElement[] = current === root
      ? [root, ...current.querySelectorAll<HTMLElement>('*')]
      : [...current.querySelectorAll<HTMLElement>('*')]
    for (const element of elements) {
      if (
        element.dataset.coursewareEditKey === key
        || element.dataset.coursewareContentKey === key
      ) {
        updateAuthoringTextElement(element, value)
        updated = true
      }
    }
  }
  return updated
}

function finiteBounds(bounds: SurfaceRuntimeBounds): SurfaceRuntimeBounds {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    throw new Error('Surface Runtime authoring bounds must be finite')
  }
  if (bounds.width < 0 || bounds.height < 0) {
    throw new Error('Surface Runtime authoring bounds cannot be negative')
  }
  return bounds
}

function trimmedAttribute(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim()
  return value || undefined
}

/**
 * Adapts Surface Runtime API 3 authoring regions to the canonical Published
 * Runtime target stream. Runtime code receives only registration/invalidation;
 * Project writes remain outside this mount.
 */
export class PublishedSurfaceRuntimeAuthoringTargets implements SurfaceRuntimeAuthoring {
  readonly #registry: RuntimeAuthoringTargetRegistry
  readonly #declarative = new Map<Element, Map<string, DeclarativeTargetRegistration>>()
  readonly #resizeObserver: ResizeObserver | null
  readonly #mutationObserver: MutationObserver | null
  readonly #resizeObservationCounts = new Map<Element, number>()
  #width: number
  #height: number
  #destroyed = false

  constructor(private readonly options: PublishedSurfaceRuntimeAuthoringTargetsOptions) {
    this.#width = options.width
    this.#height = options.height
    this.#registry = new RuntimeAuthoringTargetRegistry({
      scope: options.authoring.scope,
      ...(options.authoring.sceneId ? { sceneId: options.authoring.sceneId } : {}),
      width: options.width,
      height: options.height,
      content: options.content,
      assets: options.assets,
      onTargetsChanged: options.authoring.onTargetsChanged,
    })

    const targetWindow = options.root.ownerDocument.defaultView
    const MutationObserverConstructor = targetWindow?.MutationObserver
    this.#mutationObserver = MutationObserverConstructor
      ? new MutationObserverConstructor(() => this.#syncDeclarativeTargets())
      : null
    const ResizeObserverConstructor = targetWindow?.ResizeObserver
    this.#resizeObserver = ResizeObserverConstructor
      ? new ResizeObserverConstructor(() => this.#registry.invalidate())
      : null
    this.#observeResize(options.root)
    this.#syncDeclarativeTargets()
  }

  registerText(region: SurfaceRuntimeAuthoringRegion): () => void {
    return this.#register('text', region)
  }

  registerAsset(region: SurfaceRuntimeAuthoringRegion): () => void {
    return this.#register('asset', region)
  }

  invalidate(): void {
    if (this.#destroyed) return
    this.#syncDeclarativeTargets()
    this.#registry.invalidate()
  }

  resize(width: number, height: number): void {
    if (this.#destroyed) return
    this.#width = width
    this.#height = height
    this.#registry.resize(width, height)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#mutationObserver?.disconnect()
    this.#resizeObserver?.disconnect()
    this.#resizeObservationCounts.clear()
    this.#declarative.clear()
    this.#registry.destroy()
  }

  #register(kind: TargetKind, region: SurfaceRuntimeAuthoringRegion): () => void {
    if (this.#destroyed) {
      throw new Error('Surface Runtime authoring targets are destroyed')
    }
    const key = region.key.trim()
    if (!key) throw new Error('Surface Runtime authoring keys cannot be empty')
    this.#assertKnownKey(kind, key)

    const element = 'element' in region ? region.element : undefined
    if (element && !composedContains(this.options.root, element)) {
      throw new Error(`Surface Runtime authoring element for ${key} is outside dom.root`)
    }
    if (element) this.#observeResize(element)
    const getBounds = (): SurfaceRuntimeBounds => {
      if (element) return this.#elementBounds(element)
      const bounds = region.bounds
      if (!bounds) throw new Error(`Surface Runtime authoring bounds for ${key} are missing`)
      return finiteBounds(typeof bounds === 'function' ? bounds() : bounds)
    }
    const disposeRegistry = this.#registry.register({
      kind,
      key,
      ...(region.label?.trim() ? { label: region.label.trim() } : {}),
      getBounds,
    })
    let active = true
    return () => {
      if (!active) return
      active = false
      disposeRegistry()
      if (element) this.#unobserveResize(element)
    }
  }

  #syncDeclarativeTargets(): void {
    if (this.#destroyed) return
    this.#observeDeclarativeTrees()
    const seen = new Map<Element, Set<string>>()
    for (const element of declarativeElements(this.options.root)) {
      const textKey = trimmedAttribute(element, 'data-courseware-content-key')
        ?? trimmedAttribute(element, 'data-courseware-edit-key')
      const assetKey = trimmedAttribute(element, 'data-courseware-asset-key')
      if (textKey && this.#isKnownKey('text', textKey)) {
        this.#syncDeclarativeTarget(element, 'text', textKey, seen)
      }
      if (assetKey && this.#isKnownKey('asset', assetKey)) {
        this.#syncDeclarativeTarget(element, 'asset', assetKey, seen)
      }
    }

    for (const [element, registrations] of [...this.#declarative]) {
      const seenKeys = seen.get(element)
      for (const [registrationKey, registration] of [...registrations]) {
        if (seenKeys?.has(registrationKey)) continue
        registration.dispose()
        registrations.delete(registrationKey)
      }
      if (registrations.size === 0) this.#declarative.delete(element)
    }
    this.#registry.invalidate()
  }

  #observeDeclarativeTrees(): void {
    if (!this.#mutationObserver) return
    this.#mutationObserver.disconnect()
    for (const root of openDomRoots(this.options.root)) {
      this.#mutationObserver.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })
    }
  }

  #syncDeclarativeTarget(
    element: HTMLElement,
    kind: TargetKind,
    key: string,
    seen: Map<Element, Set<string>>,
  ): void {
    const registrationKey = `${kind}:${key}`
    let elementSeen = seen.get(element)
    if (!elementSeen) {
      elementSeen = new Set()
      seen.set(element, elementSeen)
    }
    elementSeen.add(registrationKey)

    const label = trimmedAttribute(element, 'data-courseware-edit-label')
    const signature = `${registrationKey}\u0000${label ?? ''}`
    let registrations = this.#declarative.get(element)
    if (!registrations) {
      registrations = new Map()
      this.#declarative.set(element, registrations)
    }
    const existing = registrations.get(registrationKey)
    if (existing?.signature === signature) return
    existing?.dispose()
    const dispose = this.#register(kind, {
      key,
      ...(label ? { label } : {}),
      element,
    })
    registrations.set(registrationKey, { signature, dispose })
  }

  #elementBounds(element: Element): SurfaceRuntimeBounds {
    const rootRect = this.options.root.getBoundingClientRect()
    const targetRect = element.getBoundingClientRect()
    if (rootRect.width <= 0 || rootRect.height <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }
    return {
      x: ((targetRect.left - rootRect.left) / rootRect.width) * this.#width,
      y: ((targetRect.top - rootRect.top) / rootRect.height) * this.#height,
      width: (targetRect.width / rootRect.width) * this.#width,
      height: (targetRect.height / rootRect.height) * this.#height,
    }
  }

  #assertKnownKey(kind: TargetKind, key: string): void {
    if (this.#isKnownKey(kind, key)) return
    const namespace = kind === 'text' ? 'content.values' : 'assets'
    throw new Error(`Unknown Surface Runtime ${namespace} key ${key}`)
  }

  #isKnownKey(kind: TargetKind, key: string): boolean {
    const values = kind === 'text'
      ? this.options.content.values
      : this.options.assets
    return Object.prototype.hasOwnProperty.call(values, key)
  }

  #observeResize(element: Element): void {
    if (!this.#resizeObserver) return
    const count = this.#resizeObservationCounts.get(element) ?? 0
    if (count === 0) this.#resizeObserver.observe(element)
    this.#resizeObservationCounts.set(element, count + 1)
  }

  #unobserveResize(element: Element): void {
    if (!this.#resizeObserver) return
    const count = this.#resizeObservationCounts.get(element) ?? 0
    if (count <= 1) {
      this.#resizeObservationCounts.delete(element)
      this.#resizeObserver.unobserve(element)
      return
    }
    this.#resizeObservationCounts.set(element, count - 1)
  }
}
