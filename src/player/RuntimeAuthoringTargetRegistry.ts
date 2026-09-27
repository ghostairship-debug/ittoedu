import type * as PhaserTypes from 'phaser'
import { DEFAULT_SLIDE_CANVAS, type SlideCanvasSize } from '../shared/slideCanvas'
import { observerFor, type DomTextOverrides } from './lightEdit/domTextOverrides'
import { managedHtmlDocuments, managedHtmlRect, watchManagedHtmlDocuments } from './lightEdit/htmlDocumentRoots'
import type { PhaserTextOverrides } from './lightEdit/phaserTextOverrides'
import type {
  EditableTextContent,
  RuntimeAssetBinding,
  RuntimeAuthoringApi,
  RuntimeAuthoringBounds,
  RuntimeAuthoringTarget,
  RuntimeAuthoringTargetRegistration,
  RuntimeAuthoringTargetUpdate,
  RuntimeLayer,
  RuntimeScope,
} from '../shared/runtimeTypes'

export interface RuntimeAuthoringDomRoots {
  underlay: HTMLElement
  overlay: HTMLElement
}

export type RuntimeAuthoringTargetsChangedHandler = (
  update: Readonly<RuntimeAuthoringTargetUpdate>,
) => void

/** M15: what the host recognises on its own, so the Runtime registers nothing. */
export interface RuntimeLightEditSources {
  dom?: DomTextOverrides
  phaser?: PhaserTextOverrides
  /** Binding key of a rendered image URL when it is one of the Runtime's project assets. */
  assetKeyForUrl(url: string): string | undefined
  /** Static Phaser images the Runtime created. */
  phaserImages?(): Iterable<PhaserTypes.GameObjects.Image>
  phaserLayerOf?(object: PhaserTypes.GameObjects.GameObject): RuntimeLayer
}

/** Enough for a page like the listening case (about 70 texts) without flooding the editor. */
const MAX_AUTO_TARGETS = 400

function autoLabel(text: string): string {
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}

export interface RuntimeAuthoringTargetRegistryOptions {
  scope: RuntimeScope
  sceneId?: string
  width: number
  height: number
  /** Output space for reported bounds. Callers pass the current slide canvas. */
  canvas?: SlideCanvasSize
  content: EditableTextContent
  assets: Readonly<Record<string, RuntimeAssetBinding>>
  domRoots?: RuntimeAuthoringDomRoots
  lightEdit?: RuntimeLightEditSources
  onTargetsChanged: RuntimeAuthoringTargetsChangedHandler
}

interface StoredRegistration {
  id: number
  target: RuntimeAuthoringTargetRegistration
}

const EDITABLE_DOM_SELECTOR = [
  '[data-courseware-edit-key]',
  '[data-courseware-asset-key]',
].join(',')

function finitePositiveBounds(
  bounds: unknown,
): bounds is RuntimeAuthoringBounds {
  return typeof bounds === 'object' &&
    bounds !== null &&
    Number.isFinite(Reflect.get(bounds, 'x')) &&
    Number.isFinite(Reflect.get(bounds, 'y')) &&
    Number.isFinite(Reflect.get(bounds, 'width')) &&
    Number.isFinite(Reflect.get(bounds, 'height')) &&
    (Reflect.get(bounds, 'width') as number) > 0 &&
    (Reflect.get(bounds, 'height') as number) > 0
}

function finitePositiveDomRect(rect: DOMRect): boolean {
  return Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
}

function sameBounds(
  left: Readonly<RuntimeAuthoringBounds>,
  right: Readonly<RuntimeAuthoringBounds>,
): boolean {
  return left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
}

function sameTarget(
  left: Readonly<RuntimeAuthoringTarget>,
  right: Readonly<RuntimeAuthoringTarget>,
): boolean {
  return left.targetId === right.targetId &&
    left.scope === right.scope &&
    left.sceneId === right.sceneId &&
    left.kind === right.kind &&
    left.key === right.key &&
    left.label === right.label &&
    left.multiline === right.multiline &&
    left.maxLength === right.maxLength &&
    left.layer === right.layer &&
    left.source === right.source &&
    left.lightEdit?.original === right.lightEdit?.original &&
    left.lightEdit?.region === right.lightEdit?.region &&
    left.lightEdit?.text === right.lightEdit?.text &&
    sameBounds(left.bounds, right.bounds)
}

function sameTargets(
  left: ReadonlyArray<Readonly<RuntimeAuthoringTarget>> | null,
  right: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>,
): boolean {
  return left !== null &&
    left.length === right.length &&
    left.every((target, index) => sameTarget(target, right[index]!))
}

function optionalTrimmed(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : undefined
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

/**
 * Collects explicit Runtime authoring targets without giving the runtime any
 * write access to Project data. DOM observation and callbacks stay scoped to
 * one isolated RuntimeHost instance.
 */
export class RuntimeAuthoringTargetRegistry implements RuntimeAuthoringApi {
  private readonly registrations = new Map<number, StoredRegistration>()
  private readonly domElementIds = new WeakMap<object, number>()
  private readonly mutationObservers: MutationObserver[] = []
  private readonly unwatchHtmlDocuments: Array<() => void> = []
  private readonly resizeObserver: ResizeObserver | null
  private previousTargets: ReadonlyArray<Readonly<RuntimeAuthoringTarget>> | null = null
  private nextRegistrationId = 1
  private nextDomElementId = 1
  private width: number
  private height: number
  private canvasWidth: number
  private canvasHeight: number
  private revision = 0
  private invalidationQueued = false
  private destroyed = false

  constructor(private readonly options: RuntimeAuthoringTargetRegistryOptions) {
    this.width = options.width
    this.height = options.height
    this.canvasWidth = options.canvas?.width ?? DEFAULT_SLIDE_CANVAS.width
    this.canvasHeight = options.canvas?.height ?? DEFAULT_SLIDE_CANVAS.height

    if (options.domRoots) {
      for (const root of [options.domRoots.underlay, options.domRoots.overlay]) {
        const Observer = observerFor(root)
        if (!Observer) continue
        const observer = new Observer(() => this.invalidate())
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        })
        this.mutationObservers.push(observer)
        this.unwatchHtmlDocuments.push(watchManagedHtmlDocuments(root, () => this.invalidate()))
      }
    }

    this.resizeObserver = options.domRoots && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => this.invalidate())
      : null
    if (options.domRoots && this.resizeObserver) {
      this.resizeObserver.observe(options.domRoots.underlay)
      this.resizeObserver.observe(options.domRoots.overlay)
    }

    this.invalidate()
  }

  register(target: RuntimeAuthoringTargetRegistration): () => void {
    if (this.destroyed) return () => undefined
    if (typeof target !== 'object' || target === null) {
      console.warn('运行时忽略了格式无效的画布编辑目标')
      return () => undefined
    }
    const id = this.nextRegistrationId
    this.nextRegistrationId += 1
    this.registrations.set(id, { id, target })
    this.invalidate()

    let active = true
    return () => {
      if (!active) return
      active = false
      this.registrations.delete(id)
      this.invalidate()
    }
  }

  invalidate(): void {
    if (this.destroyed || this.invalidationQueued) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      if (!this.destroyed) this.publishChangedTargets()
    })
  }

  resize(width: number, height: number): void {
    if (this.destroyed) return
    this.width = width
    this.height = height
    this.invalidate()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.invalidationQueued = false
    this.registrations.clear()
    this.unwatchHtmlDocuments.forEach(stop => stop())
    this.mutationObservers.forEach((observer) => observer.disconnect())
    this.mutationObservers.length = 0
    this.resizeObserver?.disconnect()
    if ((this.previousTargets?.length ?? 0) > 0) {
      this.publish(Object.freeze([]))
    }
    this.previousTargets = Object.freeze([])
  }

  private publishChangedTargets(): void {
    const targets = Object.freeze([
      ...this.collectDomTargets('underlay'),
      ...this.collectRegisteredTargets('underlay'),
      ...this.collectAutoTargets('underlay'),
      ...this.collectDomTargets('overlay'),
      ...this.collectRegisteredTargets('overlay'),
      ...this.collectAutoTargets('overlay'),
    ])
    if (sameTargets(this.previousTargets, targets)) return
    this.publish(targets)
    this.previousTargets = targets
  }

  private publish(
    targets: ReadonlyArray<Readonly<RuntimeAuthoringTarget>>,
  ): void {
    this.revision += 1
    try {
      this.options.onTargetsChanged(Object.freeze({
        revision: this.revision,
        scope: this.options.scope,
        ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
        targets,
      }))
    } catch (error) {
      console.error('运行时画布编辑目标回调失败', error)
    }
  }

  private collectRegisteredTargets(
    layer: RuntimeLayer,
  ): RuntimeAuthoringTarget[] {
    const scaleX = this.canvasWidth / Math.max(1, this.width)
    const scaleY = this.canvasHeight / Math.max(1, this.height)
    const targets: RuntimeAuthoringTarget[] = []

    for (const registration of this.registrations.values()) {
      const target = registration.target
      if ((target.layer ?? 'overlay') !== layer) continue
      if (!this.knownKey(target.kind, target.key)) continue
      let measured: unknown
      try {
        measured = target.getBounds()
      } catch (error) {
        console.warn('运行时画布编辑目标读取失败', error)
        continue
      }
      if (!finitePositiveBounds(measured)) continue
      const metadata = target.kind === 'text'
        ? this.options.content.metadata?.[target.key]
        : undefined
      targets.push(this.freezeTarget({
        targetId: `registered:${registration.id}`,
        scope: this.options.scope,
        ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
        kind: target.kind,
        key: target.key,
        ...(optionalTrimmed(target.label) || metadata?.label
          ? { label: optionalTrimmed(target.label) ?? metadata?.label }
          : {}),
        ...(target.kind === 'text' &&
          (optionalBoolean(target.multiline) ?? metadata?.multiline) !== undefined
          ? { multiline: optionalBoolean(target.multiline) ?? metadata?.multiline }
          : {}),
        ...(target.kind === 'text' &&
          (optionalMaxLength(target.maxLength) ?? metadata?.maxLength) !== undefined
          ? { maxLength: optionalMaxLength(target.maxLength) ?? metadata?.maxLength }
          : {}),
        layer,
        source: 'registered',
        bounds: {
          x: measured.x * scaleX,
          y: measured.y * scaleY,
          width: measured.width * scaleX,
          height: measured.height * scaleY,
        },
      }))
    }
    return targets
  }

  private collectDomTargets(layer: RuntimeLayer): RuntimeAuthoringTarget[] {
    const root = this.options.domRoots?.[layer]
    if (!root) return []
    const rootRect = root.getBoundingClientRect()
    if (!finitePositiveDomRect(rootRect)) return []

    const targets: RuntimeAuthoringTarget[] = []
    for (const element of root.querySelectorAll<HTMLElement>(EDITABLE_DOM_SELECTOR)) {
      const rect = element.getBoundingClientRect()
      if (!finitePositiveDomRect(rect)) continue
      const elementId = this.domElementId(element)
      const bounds = {
        x: ((rect.left - rootRect.left) / rootRect.width) * this.canvasWidth,
        y: ((rect.top - rootRect.top) / rootRect.height) * this.canvasHeight,
        width: (rect.width / rootRect.width) * this.canvasWidth,
        height: (rect.height / rootRect.height) * this.canvasHeight,
      }

      const textKey = optionalTrimmed(element.dataset.coursewareEditKey)
      if (textKey && this.knownKey('text', textKey)) {
        const metadata = this.options.content.metadata?.[textKey]
        const declaredMultiline = element.dataset.coursewareEditMultiline
        const multiline = declaredMultiline === 'true'
          ? true
          : declaredMultiline === 'false'
            ? false
            : metadata?.multiline
        targets.push(this.freezeTarget({
          targetId: `dom:${elementId}:text`,
          scope: this.options.scope,
          ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
          kind: 'text',
          key: textKey,
          ...(optionalTrimmed(element.dataset.coursewareEditLabel) || metadata?.label
            ? {
                label: optionalTrimmed(element.dataset.coursewareEditLabel) ??
                  metadata?.label,
              }
            : {}),
          ...(multiline !== undefined ? { multiline } : {}),
          ...(metadata?.maxLength !== undefined
            ? { maxLength: metadata.maxLength }
            : {}),
          layer,
          source: 'dom',
          bounds,
        }))
      }

      const assetKey = optionalTrimmed(element.dataset.coursewareAssetKey)
      if (assetKey && this.knownKey('asset', assetKey)) {
        targets.push(this.freezeTarget({
          targetId: `dom:${elementId}:asset`,
          scope: this.options.scope,
          ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}),
          kind: 'asset',
          key: assetKey,
          ...(optionalTrimmed(element.dataset.coursewareEditLabel)
            ? { label: optionalTrimmed(element.dataset.coursewareEditLabel) }
            : {}),
          layer,
          source: 'dom',
          bounds,
        }))
      }
    }
    return targets
  }

  /** Text and images the Runtime renders without registering them (M15). */
  private collectAutoTargets(layer: RuntimeLayer): RuntimeAuthoringTarget[] {
    const sources = this.options.lightEdit
    if (!sources) return []
    const targets: RuntimeAuthoringTarget[] = []
    const scope = { scope: this.options.scope, ...(this.options.sceneId ? { sceneId: this.options.sceneId } : {}) }
    const root = this.options.domRoots?.[layer]
    const rootRect = root?.getBoundingClientRect()
    if (root && rootRect && finitePositiveDomRect(rootRect)) {
      const toCanvas = (rect: DOMRect) => ({
        x: ((rect.left - rootRect.left) / rootRect.width) * this.canvasWidth,
        y: ((rect.top - rootRect.top) / rootRect.height) * this.canvasHeight,
        width: (rect.width / rootRect.width) * this.canvasWidth,
        height: (rect.height / rootRect.height) * this.canvasHeight,
      })
      const managed = managedHtmlDocuments(root)
      for (const sample of sources.dom?.samples() ?? []) {
        if (targets.length >= MAX_AUTO_TARGETS) break
        const document = managed.find(item => item.root === sample.root)
        if ((sample.root !== root && !document) || sample.live) continue
        // Registered keys keep their own editing path.
        if (sample.node.parentElement?.closest('[data-courseware-edit-key]')) continue
        // A text that cannot be measured is skipped, never the whole list.
        const range = sample.node.ownerDocument.createRange()
        if (typeof range.getBoundingClientRect !== 'function') continue
        range.selectNodeContents(sample.node)
        const measured = range.getBoundingClientRect()
        const rect = document ? managedHtmlRect(measured, document) : measured
        if (!finitePositiveDomRect(rect)) continue
        targets.push(this.freezeTarget({
          targetId: `auto:${this.domElementId(sample.node)}:text`,
          ...scope,
          kind: 'text',
          key: '',
          label: autoLabel(sample.rule?.text || sample.original),
          multiline: sample.original.length > 30,
          layer,
          source: 'auto',
          bounds: toCanvas(rect),
          lightEdit: { original: sample.original, region: sample.region, text: sample.rule?.text ?? sample.original },
        }))
      }
      for (const imageRoot of [{ root, document: undefined }, ...managed.map(item => ({ root: item.root, document: item }))]) for (const image of imageRoot.root.querySelectorAll('img')) {
        if (targets.length >= MAX_AUTO_TARGETS) break
        if (image.closest('[data-courseware-asset-key]')) continue
        const key = sources.assetKeyForUrl(image.currentSrc || image.src)
        if (!key || !this.knownKey('asset', key)) continue
        const measured = image.getBoundingClientRect()
        const rect = imageRoot.document ? managedHtmlRect(measured, imageRoot.document) : measured
        if (!finitePositiveDomRect(rect)) continue
        targets.push(this.freezeTarget({
          targetId: `auto:${this.domElementId(image)}:asset`,
          ...scope,
          kind: 'asset',
          key,
          label: key,
          layer,
          source: 'auto',
          bounds: toCanvas(rect),
        }))
      }
    }
    const scaleX = this.canvasWidth / Math.max(1, this.width)
    const scaleY = this.canvasHeight / Math.max(1, this.height)
    const phaserBounds = (object: { getBounds(): { x: number; y: number; width: number; height: number } }) => {
      try {
        const bounds = object.getBounds()
        return finitePositiveBounds(bounds)
          ? { x: bounds.x * scaleX, y: bounds.y * scaleY, width: bounds.width * scaleX, height: bounds.height * scaleY }
          : null
      } catch { return null }
    }
    const layerOf = sources.phaserLayerOf ?? (() => 'overlay' as const)
    for (const sample of sources.phaser?.samples() ?? []) {
      if (targets.length >= MAX_AUTO_TARGETS) break
      if (sample.live || layerOf(sample.text) !== layer) continue
      const bounds = phaserBounds(sample.text)
      if (!bounds) continue
      targets.push(this.freezeTarget({
        targetId: `auto:${this.domElementId(sample.text)}:text`,
        ...scope,
        kind: 'text',
        key: '',
        label: autoLabel(sample.rule?.text || sample.original),
        multiline: sample.original.length > 30,
        layer,
        source: 'auto',
        bounds,
        lightEdit: { original: sample.original, region: 'phaser', text: sample.rule?.text ?? sample.original },
      }))
    }
    for (const image of sources.phaserImages?.() ?? []) {
      if (targets.length >= MAX_AUTO_TARGETS) break
      if (!image.active || !image.visible || layerOf(image) !== layer) continue
      const source = image.texture?.source?.[0]?.image as { src?: unknown } | undefined
      const key = typeof source?.src === 'string' ? sources.assetKeyForUrl(source.src) : undefined
      if (!key || !this.knownKey('asset', key)) continue
      const bounds = phaserBounds(image)
      if (!bounds) continue
      targets.push(this.freezeTarget({
        targetId: `auto:${this.domElementId(image)}:asset`,
        ...scope,
        kind: 'asset',
        key,
        label: key,
        layer,
        source: 'auto',
        bounds,
      }))
    }
    return targets
  }

  private knownKey(kind: unknown, key: unknown): key is string {
    if (typeof key !== 'string' || key.trim() !== key || key.length === 0) {
      return false
    }
    if (kind === 'text') {
      return Object.prototype.hasOwnProperty.call(this.options.content.values, key)
    }
    if (kind === 'asset') {
      return Object.prototype.hasOwnProperty.call(this.options.assets, key)
    }
    return false
  }

  private domElementId(element: object): number {
    const existing = this.domElementIds.get(element)
    if (existing !== undefined) return existing
    const id = this.nextDomElementId
    this.nextDomElementId += 1
    this.domElementIds.set(element, id)
    return id
  }

  private freezeTarget(target: RuntimeAuthoringTarget): RuntimeAuthoringTarget {
    return Object.freeze({
      ...target,
      bounds: Object.freeze({ ...target.bounds }),
      ...(target.lightEdit ? { lightEdit: Object.freeze({ ...target.lightEdit }) } : {}),
    })
  }
}
