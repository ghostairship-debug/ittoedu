import type {
  ComponentAuthoringImageTarget,
  ComponentAuthoringLightEditText,
  ComponentAuthoringTarget,
  ComponentAuthoringTargetUpdate,
  ComponentAuthoringTextTarget,
  ComponentEditableTextBounds,
  ComponentEditableTextRegion,
  ComponentEditorHost,
  ComponentManifest,
  ComponentScope,
  ComponentTextProperty,
} from '../shared/componentTypes'
import {
  getComponentPropValue,
  mergeComponentProps,
  resolveComponentEditorProperties,
} from '../shared/componentProps'
import type { DomTextOverrides } from './lightEdit/domTextOverrides'

const MAX_AUTO_TARGETS = 400
function autoLabel(text: string): string {
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}

export interface ComponentHostNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  visible: boolean
  props: Record<string, unknown>
}

export type ComponentAuthoringTargetsChangedHandler = (
  update: Readonly<ComponentAuthoringTargetUpdate>,
) => void

export interface ComponentAuthoringTargetRegistryOptions {
  manifest: ComponentManifest
  node: ComponentHostNode
  scope: ComponentScope
  sceneId?: string
  domRoot?: HTMLElement
  /** M15: text and pictures the component renders itself, found by the host without any registration. */
  lightEdit?: {
    dom?: DomTextOverrides
    /** The manifest asset a picture's URL shows, if any. */
    assetKeyForUrl(url: string): string | null
  }
  onTargetsChanged: ComponentAuthoringTargetsChangedHandler
}

interface StoredTextRegion {
  id: number
  region: ComponentEditableTextRegion
}

function isFinitePositiveBounds(
  value: unknown,
): value is ComponentEditableTextBounds {
  return typeof value === 'object' &&
    value !== null &&
    Number.isFinite(Reflect.get(value, 'x')) &&
    Number.isFinite(Reflect.get(value, 'y')) &&
    Number.isFinite(Reflect.get(value, 'width')) &&
    Number.isFinite(Reflect.get(value, 'height')) &&
    (Reflect.get(value, 'width') as number) > 0 &&
    (Reflect.get(value, 'height') as number) > 0
}

function isFinitePositiveRect(value: DOMRect): boolean {
  return Number.isFinite(value.left) &&
    Number.isFinite(value.top) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
}

function optionalTrimmed(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalMaxLength(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) > 0 &&
    (value as number) <= 1_000_000
    ? value as number
    : undefined
}

function sameBounds(
  left: Readonly<ComponentEditableTextBounds>,
  right: Readonly<ComponentEditableTextBounds>,
): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
}

function sameTarget(
  left: Readonly<ComponentAuthoringTarget>,
  right: Readonly<ComponentAuthoringTarget>,
): boolean {
  if (left.kind === 'component-image' || right.kind === 'component-image') {
    return left.kind === right.kind && left.targetId === right.targetId &&
      left.nodeId === right.nodeId && left.label === right.label && left.rotation === right.rotation &&
      (left as ComponentAuthoringImageTarget).assetKey === (right as ComponentAuthoringImageTarget).assetKey &&
      sameBounds(left.bounds, right.bounds)
  }
  return left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.lightEdit?.original === right.lightEdit?.original &&
    left.lightEdit?.region === right.lightEdit?.region &&
    left.lightEdit?.text === right.lightEdit?.text &&
    left.scope === right.scope &&
    left.sceneId === right.sceneId &&
    left.nodeId === right.nodeId &&
    left.componentId === right.componentId &&
    left.key === right.key &&
    left.label === right.label &&
    left.multiline === right.multiline &&
    left.maxLength === right.maxLength &&
    left.source === right.source &&
    left.rotation === right.rotation &&
    sameBounds(left.bounds, right.bounds)
}

function sameTargets(
  left: ReadonlyArray<Readonly<ComponentAuthoringTarget>> | null,
  right: ReadonlyArray<Readonly<ComponentAuthoringTarget>>,
): boolean {
  return left !== null &&
    left.length === right.length &&
    left.every((target, index) => sameTarget(target, right[index]!))
}

/**
 * Returns an element's untransformed component-local layout box when the
 * browser exposes a complete offset-parent chain inside the component root.
 * This keeps authored node rotation out of DOM measurement.
 */
function offsetBoundsInsideRoot(
  element: HTMLElement,
  root: HTMLElement,
): ComponentEditableTextBounds | null {
  if (element.offsetWidth <= 0 || element.offsetHeight <= 0) return null
  let current: HTMLElement | null = element
  let x = 0
  let y = 0
  while (current && current !== root) {
    x += current.offsetLeft
    y += current.offsetTop
    current = current.offsetParent as HTMLElement | null
  }
  if (current !== root) return null
  return {
    x,
    y,
    width: element.offsetWidth,
    height: element.offsetHeight,
  }
}

/**
 * Collects only manifest-addressable text targets from one component instance.
 * It never mutates props and never infers editability from arbitrary DOM text.
 */
export class ComponentAuthoringTargetRegistry implements ComponentEditorHost {
  private readonly textRegions = new Map<number, StoredTextRegion>()
  private readonly domElementIds = new WeakMap<Node, number>()
  private mutationObserver: MutationObserver | null = null
  private resizeObserver: ResizeObserver | null = null
  private readonly resizeObservedElements = new Set<Element>()
  private node: ComponentHostNode
  private domRoot: HTMLElement | undefined
  private previousTargets:
    ReadonlyArray<Readonly<ComponentAuthoringTarget>> | null = null
  private nextTextRegionId = 1
  private nextDomElementId = 1
  private revision = 0
  private invalidationQueued = false
  private destroyed = false

  constructor(private readonly options: ComponentAuthoringTargetRegistryOptions) {
    this.node = options.node
    this.domRoot = options.domRoot
    this.attachDomObservers()
    this.invalidate()
  }

  registerTextRegion(region: ComponentEditableTextRegion): () => void {
    if (this.destroyed) return () => undefined
    if (typeof region !== 'object' || region === null) {
      console.warn('组件忽略了格式无效的画布文字目标')
      return () => undefined
    }
    const id = this.nextTextRegionId
    this.nextTextRegionId += 1
    this.textRegions.set(id, { id, region })
    this.invalidate()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.textRegions.delete(id)
      this.invalidate()
    }
  }

  update(node: ComponentHostNode): void {
    if (this.destroyed) return
    if (node.id !== this.node.id) {
      throw new Error('组件画布目标不能切换到另一个节点实例')
    }
    this.node = node
    this.invalidate()
  }

  setDomRoot(domRoot: HTMLElement | undefined): void {
    if (this.destroyed || domRoot === this.domRoot) return
    this.detachDomObservers()
    this.domRoot = domRoot
    this.attachDomObservers()
    this.invalidate()
  }

  /** Coalesces component-driven bounds changes without polling every frame. */
  invalidate(): void {
    if (this.destroyed || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      if (!this.destroyed) this.publishChangedTargets()
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.invalidationQueued = false
    this.textRegions.clear()
    this.detachDomObservers()
    if ((this.previousTargets?.length ?? 0) > 0) {
      this.publish(Object.freeze([]))
    }
    this.previousTargets = Object.freeze([])
  }

  private publishChangedTargets(): void {
    const fields = this.resolveTextFields()
    const targets = Object.freeze(this.node.visible
      ? [
          ...this.collectDomTargets(fields),
          ...this.collectRegisteredTargets(fields),
          ...this.collectAutoTargets(),
        ]
      : [])
    if (sameTargets(this.previousTargets, targets)) return
    this.publish(targets)
    this.previousTargets = targets
  }

  private publish(
    targets: ReadonlyArray<Readonly<ComponentAuthoringTarget>>,
  ): void {
    this.revision += 1
    try {
      this.options.onTargetsChanged(Object.freeze({
        revision: this.revision,
        scope: this.options.scope,
        ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
        nodeId: this.node.id,
        targets,
      }))
    } catch (error) {
      console.error('组件画布文字目标回调失败', error)
    }
  }

  private resolveTextFields(): Map<string, ComponentTextProperty> {
    const effectiveProps = mergeComponentProps(
      this.options.manifest,
      this.node.props,
    )
    return new Map(resolveComponentEditorProperties(
      this.options.manifest,
      this.node.props,
    ).flatMap((property) => {
      if (
        property.type !== 'text' && property.type !== 'textarea' ||
        typeof getComponentPropValue(effectiveProps, property.key) !== 'string'
      ) {
        return []
      }
      return [[property.key, property] as const]
    }))
  }

  private collectRegisteredTargets(
    fields: ReadonlyMap<string, ComponentTextProperty>,
  ): ComponentAuthoringTextTarget[] {
    const targets: ComponentAuthoringTextTarget[] = []
    for (const stored of this.textRegions.values()) {
      const field = fields.get(stored.region.key)
      if (!field) continue
      let localBounds: unknown
      try {
        localBounds = stored.region.getBounds()
      } catch (error) {
        console.warn('组件画布文字目标读取失败', error)
        continue
      }
      if (!isFinitePositiveBounds(localBounds)) continue
      targets.push(this.createTarget(
        `registered:${stored.id}`,
        stored.region.key,
        optionalTrimmed(stored.region.label) ?? field.label,
        optionalBoolean(stored.region.multiline) ?? field.type === 'textarea',
        optionalMaxLength(stored.region.maxLength) ?? field.maxLength,
        'registered',
        localBounds,
      ))
    }
    return targets
  }

  private collectDomTargets(
    fields: ReadonlyMap<string, ComponentTextProperty>,
  ): ComponentAuthoringTextTarget[] {
    const root = this.domRoot
    if (!root) return []
    const candidates = [
      ...root.querySelectorAll<HTMLElement>('[data-courseware-edit-key]'),
    ]
    this.syncResizeObservedElements(candidates)
    const rootRect = root.getBoundingClientRect()
    const canUseClientRect = isFinitePositiveRect(rootRect)
    const targets: ComponentAuthoringTextTarget[] = []

    for (const element of candidates) {
      const key = optionalTrimmed(element.dataset.coursewareEditKey)
      const field = key ? fields.get(key) : undefined
      if (!key || !field) continue
      const offsetBounds = offsetBoundsInsideRoot(element, root)
      const elementRect = offsetBounds ? null : element.getBoundingClientRect()
      const localBounds = offsetBounds ?? (
        canUseClientRect && elementRect && isFinitePositiveRect(elementRect)
          ? {
              x: ((elementRect.left - rootRect.left) / rootRect.width) *
                this.node.width,
              y: ((elementRect.top - rootRect.top) / rootRect.height) *
                this.node.height,
              width: (elementRect.width / rootRect.width) * this.node.width,
              height: (elementRect.height / rootRect.height) * this.node.height,
            }
          : null
      )
      if (!localBounds || !isFinitePositiveBounds(localBounds)) continue
      targets.push(this.createTarget(
        `dom:${this.domElementId(element)}`,
        key,
        optionalTrimmed(element.dataset.coursewareEditLabel) ?? field.label,
        element.dataset.coursewareEditMultiline === 'true' ||
          field.type === 'textarea',
        field.maxLength,
        'dom',
        localBounds,
      ))
    }
    return targets
  }

  /**
   * Text and pictures the component renders itself (M15): every visible text that is not program-computed and not
   * already declared, and every picture showing one of the component's manifest assets.
   */
  private collectAutoTargets(): ComponentAuthoringTarget[] {
    const root = this.domRoot, sources = this.options.lightEdit
    if (!root || !sources) return []
    const rootRect = root.getBoundingClientRect()
    const toLocal = (rect: DOMRect): ComponentEditableTextBounds | null => isFinitePositiveRect(rootRect) && isFinitePositiveRect(rect) ? {
      x: ((rect.left - rootRect.left) / rootRect.width) * this.node.width,
      y: ((rect.top - rootRect.top) / rootRect.height) * this.node.height,
      width: (rect.width / rootRect.width) * this.node.width,
      height: (rect.height / rootRect.height) * this.node.height,
    } : null
    const targets: ComponentAuthoringTarget[] = []
    const range = root.ownerDocument.createRange()
    for (const sample of sources.dom?.samples() ?? []) {
      if (targets.length >= MAX_AUTO_TARGETS) break
      if (sample.root !== root || sample.live) continue
      // Declared text keeps its own editing path.
      if (sample.node.parentElement?.closest('[data-courseware-edit-key]')) continue
      const parent = sample.node.parentElement
      let local = parent && parent.childNodes.length === 1 ? offsetBoundsInsideRoot(parent, root) : null
      // A text that cannot be measured is skipped, never the whole list.
      if (!local && typeof range.getBoundingClientRect === 'function') { range.selectNodeContents(sample.node); local = toLocal(range.getBoundingClientRect()) }
      if (!local || !isFinitePositiveBounds(local)) continue
      targets.push(this.createTarget(`auto:${this.domElementId(sample.node)}:text`, '', autoLabel(sample.rule?.text || sample.original),
        sample.original.length > 30, undefined, 'auto', local,
        { original: sample.original, region: sample.region, text: sample.rule?.text ?? sample.original }))
    }
    for (const image of root.querySelectorAll('img')) {
      if (targets.length >= MAX_AUTO_TARGETS) break
      const assetKey = sources.assetKeyForUrl(image.getAttribute('src') ?? '') ?? sources.assetKeyForUrl(image.currentSrc || image.src)
      if (!assetKey) continue
      const local = offsetBoundsInsideRoot(image, root) ?? toLocal(image.getBoundingClientRect())
      if (!local || !isFinitePositiveBounds(local)) continue
      targets.push(Object.freeze({
        kind: 'component-image' as const,
        targetId: `auto:${this.domElementId(image)}:image`,
        scope: this.options.scope,
        ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
        nodeId: this.node.id,
        componentId: this.options.manifest.id,
        assetKey,
        label: '图片',
        source: 'auto' as const,
        bounds: this.stageBounds(local),
        rotation: this.node.rotation,
      }))
    }
    return targets
  }

  private createTarget(
    targetId: string,
    key: string,
    label: string,
    multiline: boolean,
    maxLength: number | undefined,
    source: ComponentAuthoringTextTarget['source'],
    localBounds: ComponentEditableTextBounds,
    lightEdit?: ComponentAuthoringLightEditText,
  ): ComponentAuthoringTextTarget {
    return Object.freeze({
      kind: 'component-text',
      targetId,
      scope: this.options.scope,
      ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
      nodeId: this.node.id,
      componentId: this.options.manifest.id,
      key,
      label,
      multiline,
      ...(maxLength !== undefined ? { maxLength } : {}),
      source,
      ...(lightEdit ? { lightEdit: Object.freeze(lightEdit) } : {}),
      bounds: this.stageBounds(localBounds),
      rotation: this.node.rotation,
    })
  }

  /** A rectangle in the component's local space, placed in the stage around the node's rotated centre. */
  private stageBounds(localBounds: ComponentEditableTextBounds): Readonly<ComponentEditableTextBounds> {
    const angle = this.node.rotation * Math.PI / 180
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const nodeCenterX = this.node.x + this.node.width / 2
    const nodeCenterY = this.node.y + this.node.height / 2
    const localCenterX = localBounds.x + localBounds.width / 2
    const localCenterY = localBounds.y + localBounds.height / 2
    const deltaX = localCenterX - this.node.width / 2
    const deltaY = localCenterY - this.node.height / 2
    const targetCenterX = nodeCenterX + deltaX * cosine - deltaY * sine
    const targetCenterY = nodeCenterY + deltaX * sine + deltaY * cosine
    return Object.freeze({
      x: targetCenterX - localBounds.width / 2,
      y: targetCenterY - localBounds.height / 2,
      width: localBounds.width,
      height: localBounds.height,
    })
  }

  private attachDomObservers(): void {
    if (!this.domRoot) return
    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => this.invalidate())
      this.mutationObserver.observe(this.domRoot, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      })
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.invalidate())
      this.resizeObserver.observe(this.domRoot)
    }
  }

  private detachDomObservers(): void {
    this.mutationObserver?.disconnect()
    this.mutationObserver = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.resizeObservedElements.clear()
  }

  private syncResizeObservedElements(elements: readonly Element[]): void {
    if (!this.resizeObserver) return
    const next = new Set(elements)
    for (const element of this.resizeObservedElements) {
      if (!next.has(element)) this.resizeObserver.unobserve(element)
    }
    for (const element of next) {
      if (!this.resizeObservedElements.has(element)) {
        this.resizeObserver.observe(element)
      }
    }
    this.resizeObservedElements.clear()
    next.forEach((element) => this.resizeObservedElements.add(element))
  }

  private domElementId(element: Node): number {
    const existing = this.domElementIds.get(element)
    if (existing !== undefined) return existing
    const id = this.nextDomElementId
    this.nextDomElementId += 1
    this.domElementIds.set(element, id)
    return id
  }
}
