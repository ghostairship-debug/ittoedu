import { findCompositionNode, type CompositionNode } from '../../shared/composition/content'
import type { NativeInputContent } from '../../shared/contracts/native-v1/types'
import type { PublishedCompositionLayerItem, PublishedRuntimeLayerItem } from '../../shared/publishedCourseTypes'
import type { CourseStateStore, RuntimeHostActions, RuntimePresentationApi } from '../../shared/runtimeTypes'
import type { ComponentHostActions } from '../../shared/componentTypes'
import { FLOW_COMPONENT_BLOCK_HEIGHT } from '../../shared/flowBodyPresentation'
import { nativeRenderInputFromLayerItem, paintPublishedNativeRenderInput } from '../surfaces/native/publishedNativeRendering'
import { mountPublishedSurfaceRuntime, type PublishedSurfaceRuntimeMountHandle, type PublishedSurfaceRuntimeSession } from '../surfaces/runtime/publishedSurfaceRuntimeMount'
import { mountPublishedCanvasRuntime, type PublishedCanvasRuntimeMountHandle } from '../surfaces/runtime/publishedCanvasRuntimeMount'
import { registerPublishedCaptureResource } from '../surfaces/publishedCapture'
import { mountPublishedComponent, type PublishedComponentMountHandle, type PublishedComponentPackageSource } from '../surfaces/publishedComponentMount'
import { paintCompositionDocument, type CompositionDocumentComponent } from './documentContent'
import type { PublishedInputDescriptor } from '../interactions/PublishedInteractionSurfacePort'
import { bindPublishedNativeInputSubmit } from './nativeInput'
import { componentReferenceName, projectReferencePath, resolveCssAssetReferences } from '../../shared/composition/projectReferences'
import {
  compositionHostStyleText,
  HOST_NODE_ATTRIBUTE,
  PENDING_ATTRIBUTE,
  pendingImageUrl,
  placeholderDocument,
  placeholderElement,
  resolveCompositionAttribute,
  themeHtmlDocumentRuntimes,
} from './compositionHostDocument'

type Content = PublishedCompositionLayerItem['content']
type Runtime = PublishedRuntimeLayerItem['runtime']
type ContentNode = CompositionNode<Runtime>
type RuntimeHandle = PublishedSurfaceRuntimeMountHandle | PublishedCanvasRuntimeMountHandle
export interface CompositionBounds { x: number; y: number; width: number; height: number }
/** Read-only browser layout facts for author gestures; none become stored content. */
export interface CompositionLayoutObservation {
  bounds: CompositionBounds
  position: string
  display: string
  flexDirection: string
  gridAutoFlow: string
  direction: string
  order: number
  gridPlaced: boolean
  transformed: boolean
  horizontal: boolean
  left: number
  top: number
  width: number
  height: number
  minWidth: number
  minHeight: number
  maxWidth: number
  maxHeight: number
  stretchWidth: boolean
  stretchHeight: boolean
}
export interface WebCompositionMountOptions {
  instanceId: string
  content: Content
  width: number
  height: number
  mode?: 'authoring' | 'playback' | 'capture'
  visible?: boolean
  /** Course theme style text (`courseThemeStyleText`), applied to this document and the component documents in it. */
  theme?: string
  resolveAsset(id: string): string | undefined
  session: PublishedSurfaceRuntimeSession
  courseState?: CourseStateStore
  projectId?: string
  components?: Readonly<Record<string, PublishedComponentPackageSource>>
  componentActions?: Readonly<ComponentHostActions>
  actions?: Readonly<RuntimeHostActions>
  presentation?: RuntimePresentationApi
  sceneId?: string
  /** The owning Slide validates the existing state declarations and answer contract. */
  describeInput?(nodeId: string, input: NativeInputContent): PublishedInputDescriptor | null
  onSelection?(selection: { layerItemId: string; nodeId: string; bounds: CompositionBounds }): void
  reportError?(error: Error): void
}
export interface WebCompositionMountHandle {
  readonly ready: Promise<void>
  readonly element: HTMLIFrameElement
  update(content: Content): Promise<void>
  resize(width: number, height: number): void
  measure(nodeId: string): CompositionBounds | null
  observeLayout(nodeId: string): CompositionLayoutObservation | null
  describeInput(nodeId: string): PublishedInputDescriptor | null
  bindInputSubmit(nodeId: string, listener: (rawValue: string) => void): (() => void) | null
  waitForReady(): Promise<void>
  waitForObservationReady(): Promise<void>
  waitForCaptureReady(): Promise<void>
  restoreAfterCapture(): void
  setVisible(visible: boolean): void
  suspend(): void
  resume(): void
  destroy(): void
}
interface MountedNode {
  content: ContentNode
  dom: Node
  runtime?: RuntimeHandle
  components?: Map<string, { block: CompositionDocumentComponent; element: HTMLElement; handle?: PublishedComponentMountHandle; signature?: string }>
  signature?: string
  width?: number
  height?: number
  embedded?: { ready: Promise<void>; attach(): void; dispose(): void }
  disposeInput?: () => void
}

/** One real layout viewport; source nodes and measured geometry have separate owners. */
export function mountWebComposition(parent: HTMLElement, options: WebCompositionMountOptions): WebCompositionMountHandle {
  const iframe = parent.ownerDocument.createElement('iframe')
  iframe.dataset.webComposition = options.instanceId
  iframe.title = '可编辑组合内容'
  iframe.style.cssText = 'display:block;border:0;transform-origin:0 0;'
  iframe.style.width = `${options.width}px`; iframe.style.height = `${options.height}px`
  const nodes = new Map<string, MountedNode>()
  const inputListeners = new Map<string, Set<(rawValue: string) => void>>()
  let current = options.content
  let dom: Document | null = null
  let destroyed = false, visible = options.visible !== false, suspended = false
  let observer: ResizeObserver | undefined
  let finishLoad: (() => void) | undefined
  let frame = 0
  let failure: Error | undefined
  const fail = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    failure = error; parent.dataset.compositionError = error.message; options.reportError?.(error)
    return error
  }
  const resolveUrl = (value: string) => value.replace(/cw-resource:([a-zA-Z0-9_.-]+)/g, (original, key: string) => {
    const ref = current.assets[key]
    return ref ? options.resolveAsset(ref.assetId) ?? original : original
  })
  const resolveStyleText = (value: string) => resolveCssAssetReferences(resolveUrl(value), current.assets, options.resolveAsset)
  const isHostNode = (node: Node) => node.nodeType === 1 && (node as Element).hasAttribute(HOST_NODE_ATTRIBUTE)
  let hostStyle: HTMLStyleElement | undefined
  const ensureHostStyle = (): void => {
    const container = dom?.head ?? dom?.documentElement
    if (!dom || !container) return
    if (!hostStyle) {
      hostStyle = dom.createElement('style')
      hostStyle.setAttribute(HOST_NODE_ATTRIBUTE, 'style')
      hostStyle.textContent = compositionHostStyleText(options.theme, options.mode ?? 'playback')
    }
    if (container.firstChild !== hostStyle) container.insertBefore(hostStyle, container.firstChild)
  }
  /** Attributes as rendered: bound asset slots resolved; unfilled images and component frames show placeholders. */
  const renderedAttributes = (content: Extract<ContentNode, { kind: 'element' }>, embedded: boolean): Record<string, string> => {
    const tag = content.tagName.toLowerCase()
    const src = content.attributes.src
    // A project file is never fetched by URL: a component is mounted under the frame, otherwise a placeholder shows.
    const projectFrame = tag === 'iframe' && src !== undefined && projectReferencePath(src) !== null
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(content.attributes)) {
      if (projectFrame && key.toLowerCase() === 'src') continue
      result[key] = resolveCompositionAttribute(key, resolveUrl(value), current.assets, options.resolveAsset)
    }
    if (projectFrame && !embedded) {
      result.srcdoc = placeholderDocument('待填组件', content.attributes.title || componentReferenceName(src!) || src!)
      result[PENDING_ATTRIBUTE] = 'component'
    }
    if (tag === 'img' && src !== undefined && projectReferencePath(src) && result.src === src) {
      result.src = pendingImageUrl(content.attributes.alt)
      result[PENDING_ATTRIBUTE] = 'asset'
      if (content.attributes.alt && result.title === undefined) result.title = content.attributes.alt
    }
    return result
  }
  const destroyNode = (record: MountedNode) => {
    record.embedded?.dispose()
    record.disposeInput?.()
    record.runtime?.destroy()
    for (const component of record.components?.values() ?? []) component.handle?.destroy()
    if (record.dom.nodeType === 1) observer?.unobserve(record.dom as Element)
  }
  const reportLeafError = (element: HTMLElement, error: Error): void => {
    if (element.dataset.compositionLeafError === error.message) return
    element.dataset.compositionLeafError = error.message
    const note = dom!.createElement('div')
    note.dataset.compositionDiagnostic = 'true'; note.setAttribute('role', 'note'); note.textContent = error.message
    note.style.cssText = 'font:12px sans-serif;color:#9a3412;line-height:14px;'
    element.append(note)
    options.reportError?.(error)
  }
  const componentHandles = () => [...nodes.values()].flatMap(record => [...record.components?.values() ?? []].flatMap(component => component.handle ? [component.handle] : []))
  const inputId = (nodeId: string) => `${options.instanceId}/${nodeId}`
  const describeInput = (nodeId: string): PublishedInputDescriptor | null => {
    if (destroyed || options.mode === 'authoring' || options.mode === 'capture') return null
    const prefix = `${options.instanceId}/`
    if (!nodeId.startsWith(prefix)) return null
    const source = findCompositionNode(current.root, nodeId.slice(prefix.length))
    return source?.kind === 'native' && source.content.nativeType === 'input'
      ? options.describeInput?.(nodeId, source.content.data) ?? null : null
  }
  const refreshInputAvailability = (nodeId: string): void => {
    const record = nodes.get(nodeId)
    if (!record || record.dom.nodeType !== 1) return
    const element = record.dom as HTMLElement, button = element.querySelector('button')
    if (!button) return
    const id = inputId(nodeId), descriptor = describeInput(id)
    button.disabled = !descriptor || !(inputListeners.get(id)?.size)
    button.title = button.disabled ? '此输入框未配置可运行的提交规则' : ''
  }
  const bindInputSubmit = (nodeId: string, listener: (rawValue: string) => void): (() => void) | null => {
    if (!describeInput(nodeId)) return null
    let listeners = inputListeners.get(nodeId)
    if (!listeners) { listeners = new Set(); inputListeners.set(nodeId, listeners) }
    listeners.add(listener)
    const sourceId = nodeId.slice(options.instanceId.length + 1)
    refreshInputAvailability(sourceId)
    return () => {
      listeners!.delete(listener)
      if (!listeners!.size) inputListeners.delete(nodeId)
      refreshInputAvailability(sourceId)
    }
  }
  const measure = (id: string): CompositionBounds | null => {
    const node = nodes.get(id)?.dom
    if (!node || node.nodeType !== 1) return null
    const rect = (node as Element).getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  const observeLayout = (id: string): CompositionLayoutObservation | null => {
    const node = nodes.get(id)?.dom, win = dom?.defaultView
    if (!node || node.nodeType !== 1 || !win || !(node instanceof win.HTMLElement)) return null
    const style = win.getComputedStyle(node), bounds = measure(id)!
    const number = (value: string, fallback: number) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback
    const containingWidth = style.position === 'fixed' ? dom!.documentElement.clientWidth : node.offsetParent?.clientWidth ?? dom!.documentElement.clientWidth
    const containingHeight = style.position === 'fixed' ? dom!.documentElement.clientHeight : node.offsetParent?.clientHeight ?? dom!.documentElement.clientHeight
    const limit = (value: string, base: number, fallback: number) => value.endsWith('px') ? number(value, fallback)
      : value.endsWith('%') ? number(value, 0) * base / 100 : fallback
    let transformed = false
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      const css = win.getComputedStyle(ancestor)
      if (css.transform !== 'none' || css.perspective !== 'none' || !['none', ''].includes(css.translate || '')
        || !['none', ''].includes(css.rotate || '') || !['none', ''].includes(css.scale || '')
        || !['1', 'normal', ''].includes(css.zoom || '')) transformed = true
    }
    const specified = node.computedStyleMap?.()
    const auto = (property: string) => specified?.get(property)?.toString() === 'auto'
    return { bounds, position: style.position, display: style.display, flexDirection: style.flexDirection,
      gridAutoFlow: style.gridAutoFlow, direction: style.direction, order: number(style.order, 0),
      gridPlaced: style.gridColumnStart !== 'auto' || style.gridRowStart !== 'auto', transformed,
      horizontal: style.writingMode === 'horizontal-tb',
      left: number(style.left, node.offsetLeft - number(style.marginLeft, 0)),
      top: number(style.top, node.offsetTop - number(style.marginTop, 0)),
      width: number(style.width, NaN), height: number(style.height, NaN),
      minWidth: limit(style.minWidth, containingWidth, 0), minHeight: limit(style.minHeight, containingHeight, 0),
      maxWidth: limit(style.maxWidth, containingWidth, Infinity), maxHeight: limit(style.maxHeight, containingHeight, Infinity),
      stretchWidth: auto('width') && !auto('left') && !auto('right'),
      stretchHeight: auto('height') && !auto('top') && !auto('bottom') }
  }
  function paintLeaves(): void {
    if (destroyed || !dom) return
    for (const record of nodes.values()) record.embedded?.attach()
    for (const [id, record] of nodes) {
      const content = record.content
      if (content.kind !== 'native' && content.kind !== 'runtime' && content.kind !== 'document') continue
      const element = record.dom as HTMLElement
      if (!element.isConnected) continue
      const width = Math.max(1, element.clientWidth)
      const height = Math.max(1, element.clientHeight)
      if (content.kind === 'native') {
        const signature = JSON.stringify(content.content)
        if (record.signature === signature && record.width === width && record.height === height) continue
        // Native inputs size with CSS. Keep the actual control, focus and IME
        // session during reflow rather than recreating it for browser geometry.
        if (content.content.nativeType === 'input' && record.signature === signature) {
          record.width = width; record.height = height
          continue
        }
        const previousInput = element.querySelector('input')
        const inputState = previousInput && { value: previousInput.value, defaultValue: previousInput.defaultValue,
          focused: dom.activeElement === previousInput, start: previousInput.selectionStart, end: previousInput.selectionEnd,
          direction: previousInput.selectionDirection }
        record.disposeInput?.(); delete record.disposeInput
        element.replaceChildren()
        delete element.dataset.compositionLeafError
        paintPublishedNativeRenderInput(element, nativeRenderInputFromLayerItem({
          layerItemId: content.content.nativeType === 'input' ? inputId(id) : id, kind: 'native', content: content.content,
          frame: { mode: 'absolute', x: 0, y: 0, width, height }, rotation: 0, opacity: 1,
          visible: true, playbackInitialVisibility: 'inherit',
        }), { resolveAsset: options.resolveAsset }, { staticCapture: options.mode === 'capture' })
        if (content.content.nativeType === 'input') {
          const input = element.querySelector('input')
          if (input && inputState) {
            input.value = inputState.value; input.defaultValue = inputState.defaultValue
            if (inputState.focused) input.focus({ preventScroll: true })
            if (inputState.start !== null && inputState.end !== null) input.setSelectionRange(inputState.start, inputState.end, inputState.direction ?? undefined)
          }
          const publicId = inputId(id)
          record.disposeInput = bindPublishedNativeInputSubmit(element, publicId,
            () => visible && !suspended && !!describeInput(publicId),
            raw => { for (const listener of [...inputListeners.get(publicId) ?? []]) listener(raw) })
          const form = element.querySelector('form')
          if (form) form.addEventListener('submit', event => event.preventDefault())
          refreshInputAvailability(id)
          if (options.mode !== 'authoring' && options.mode !== 'capture' && !describeInput(publicId)) {
            if (form) form.style.height = 'calc(100% - 28px)'
            reportLeafError(element, new Error('此输入框可填写；未配置有效的提交与判题规则。'))
          }
        }
        record.signature = signature
      } else if (content.kind === 'document') {
        const signature = JSON.stringify(content.content)
        if (record.signature === signature && record.width === width) continue
        record.components ??= new Map()
        const usedComponents = new Set<string>()
        paintCompositionDocument(element, content.content, options.resolveAsset, {
          reportError: error => options.reportError?.(error),
          renderComponent(block) {
            usedComponents.add(block.id)
            let component = record.components!.get(block.id)
            if (component && (component.block.component.packageId !== block.component.packageId || component.block.component.version !== block.component.version)) {
              component.handle?.destroy(); record.components!.delete(block.id); component = undefined
            }
            if (!component) {
              component = { block, element: dom!.createElement('div') }
              record.components!.set(block.id, component)
            }
            component.block = block
            component.element.style.cssText = `position:relative;height:${FLOW_COMPONENT_BLOCK_HEIGHT}px;width:${block.wrap === 'left' || block.wrap === 'right' ? '48%' : '100%'};float:${block.wrap === 'left' || block.wrap === 'right' ? block.wrap : 'none'};`
            return component.element
          },
        })
        for (const [componentId, component] of record.components) {
          if (!usedComponents.has(componentId)) { component.handle?.destroy(); record.components.delete(componentId); continue }
          const block = component.block
          const componentWidth = Math.max(1, component.element.clientWidth)
          const propsSignature = JSON.stringify(block.props)
          if (!component.handle) {
            component.handle = mountPublishedComponent(component.element, {
              container: component.element, componentId: block.component.packageId, version: block.component.version,
              instanceId: `${options.instanceId}/${id}/${block.id}`, width: componentWidth, height: FLOW_COMPONENT_BLOCK_HEIGHT,
              props: block.props, staticFallbackAssetId: block.staticFallbackAssetId,
              projectId: options.projectId, components: options.components, resolveAsset: options.resolveAsset,
              mode: options.mode === 'authoring' ? 'edit' : options.mode === 'capture' ? 'capture' : 'preview',
              sceneId: options.sceneId, interactive: options.mode !== 'authoring', actions: options.componentActions,
              events: options.session.events, courseState: options.courseState ?? options.session.courseState,
              presentation: options.presentation,
              reportError: (_phase, error) => reportLeafError(component.element, error),
            })
            component.handle.setVisible(visible)
            if (suspended) component.handle.suspend()
          } else {
            component.handle.resize(componentWidth, FLOW_COMPONENT_BLOCK_HEIGHT)
            if (component.signature !== propsSignature) component.handle.updateProps(block.props)
          }
          component.signature = propsSignature
        }
        record.signature = signature
      } else {
        if (!content.runtime.enabled) {
          const draft = content.runtime.draft ? `draft:${content.runtime.draft.reason}` : undefined
          if (record.signature === draft && !record.runtime) continue
          record.runtime?.destroy(); delete record.runtime; element.replaceChildren()
          // A component saved without admission shows why instead of running.
          if (content.runtime.draft) element.append(placeholderElement(dom, '组件未通过检查', content.runtime.draft.reason))
          record.signature = draft
          continue
        }
        const signature = JSON.stringify(content.runtime)
        if (record.runtime && record.signature !== signature) { record.runtime.destroy(); delete record.runtime; element.replaceChildren() }
        if (!record.runtime) {
          const input = {
            instanceId: `${options.instanceId}/${id}`, runtime: content.runtime, width, height,
            visible, mode: options.mode ?? 'playback', resolveAsset: options.resolveAsset,
            session: options.session, courseState: options.courseState, actions: options.actions,
            presentation: options.presentation, reportError: (_phase: string, error: Error) => { fail(error) },
          }
          record.runtime = content.runtime.protocol === 'surface-runtime'
            ? mountPublishedSurfaceRuntime(element, input)
            : mountPublishedCanvasRuntime(element, { ...input, sceneId: options.sceneId ?? options.instanceId, canvas: { width, height } })
          if (options.theme) themeHtmlDocumentRuntimes(element, options.theme)
          record.signature = signature
          if (!record.runtime.ok) throw new Error(`组合互动区域无法运行：${id}`)
          if (suspended) record.runtime.suspend()
        } else if (record.width !== width || record.height !== height) record.runtime.updateSize(width, height)
      }
      record.width = width; record.height = height
    }
  }
  function scheduleLayout(): void {
    if (!dom?.defaultView || frame || destroyed) return
    frame = dom.defaultView.requestAnimationFrame(() => { frame = 0; try { paintLeaves() } catch (error) { fail(error) } })
  }
  function makeNode(content: ContentNode): Node {
    if (!dom) throw new Error('组合文档尚未挂载')
    if (content.kind === 'text') return dom.createTextNode(content.text)
    if (content.kind === 'comment') return dom.createComment(content.text)
    if (content.kind === 'element') {
      if (content.tagName === '#document') return dom
      if (content.tagName.toLowerCase() === 'script' && !/^(application\/(ld\+)?json|importmap)$/i.test(content.attributes.type ?? '')) {
        throw new Error('可执行脚本需要保留在程序区域，不能作为静态组合元素运行')
      }
      return content.namespace ? dom.createElementNS(content.namespace, content.tagName) : dom.createElement(content.tagName)
    }
    const element = dom.createElement('div')
    element.dataset.compositionLeaf = content.kind
    element.style.cssText = content.kind === 'document' ? 'min-width:0;' : 'display:block;width:100%;height:100%;min-width:0;'
    observer?.observe(element)
    return element
  }
  function reconcile(content: ContentNode, used: Set<string>): Node {
    used.add(content.id)
    let record = nodes.get(content.id)
    if (record && (record.content.kind !== content.kind || (record.content.kind === 'element' && content.kind === 'element'
      && (record.content.tagName !== content.tagName || record.content.namespace !== content.namespace)))) {
      destroyNode(record); record.dom.parentNode?.removeChild(record.dom); nodes.delete(content.id); record = undefined
    }
    if (!record) { record = { content, dom: makeNode(content) }; nodes.set(content.id, record) }
    record.content = content
    if (content.kind === 'text' || content.kind === 'comment') {
      const text = content.kind === 'text' && record.dom.parentElement?.tagName === 'STYLE' ? resolveStyleText(content.text) : content.text
      if (record.dom.nodeValue !== text) record.dom.nodeValue = text
    } else if (content.kind === 'element') {
      const embedded = content.tagName.toLowerCase() === 'iframe' && content.children.length === 1
        && content.children[0]?.kind === 'runtime'
      if (record.dom.nodeType === 1) {
        const element = record.dom as Element
        const attributes = renderedAttributes(content, embedded)
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name !== 'data-composition-node' && !(embedded && attribute.name === 'srcdoc') && !(attribute.name in attributes)) element.removeAttribute(attribute.name)
        }
        for (const [key, resolved] of Object.entries(attributes)) {
          if (element.getAttribute(key) !== resolved) element.setAttribute(key, resolved)
        }
        element.setAttribute('data-composition-node', content.id)
      }
      const desired = content.children.map(child => reconcile(child, used))
      if (embedded) {
        const frameElement = record.dom as HTMLIFrameElement
        if (!record.embedded) {
          let ready = false, dispose = false
          let finish: () => void = () => undefined
          const promise = new Promise<void>(resolve => { finish = resolve })
          const attach = () => {
            if (!ready || dispose || !frameElement.isConnected) return
            const childDocument = frameElement.contentDocument
            if (!childDocument?.body) return
            childDocument.documentElement.style.cssText = 'width:100%;height:100%;'
            childDocument.body.style.cssText = 'margin:0;width:100%;height:100%;overflow:hidden;'
            const source = nodes.get(content.id)?.content
            const child = source?.kind === 'element' ? source.children[0] : undefined
            const leaf = child && nodes.get(child.id)?.dom
            if (leaf && leaf.parentNode !== childDocument.body) childDocument.body.replaceChildren(leaf)
          }
          const loaded = () => { ready = true; attach(); finish(); scheduleLayout() }
          frameElement.addEventListener('load', loaded)
          observer?.observe(frameElement)
          record.embedded = { ready: promise, attach, dispose() {
            dispose = true; frameElement.removeEventListener('load', loaded); finish()
          } }
          // This document is a derived mount container; its program lives in the Runtime leaf.
          frameElement.srcdoc = '<!doctype html><html><head></head><body></body></html>'
        }
        record.embedded.attach()
        for (const child of Array.from(record.dom.childNodes)) record.dom.removeChild(child)
        return record.dom
      }
      if (record.embedded) { record.embedded.dispose(); delete record.embedded }
      let cursor = record.dom.firstChild
      while (cursor && (cursor.nodeType === 10 || isHostNode(cursor))) cursor = cursor.nextSibling
      for (const child of desired) {
        if (child === cursor) { cursor = cursor.nextSibling; continue }
        const movable = record.dom as Node & { moveBefore?(node: Node, before: Node | null): void }
        if (movable.moveBefore && child.isConnected && movable.isConnected) movable.moveBefore(child, cursor)
        else record.dom.insertBefore(child, cursor)
      }
      for (const child of Array.from(record.dom.childNodes)) if (!desired.includes(child) && child.nodeType !== 10 && !isHostNode(child)) record.dom.removeChild(child)
    } else (record.dom as Element).setAttribute('data-composition-node', content.id)
    return record.dom
  }
  function apply(content: Content): void {
    current = content; failure = undefined; delete parent.dataset.compositionError
    const used = new Set<string>()
    const root = reconcile(content.root, used)
    if (root !== dom && root.parentNode !== dom) dom!.appendChild(root)
    for (const [id, record] of nodes) if (!used.has(id)) { destroyNode(record); record.dom.parentNode?.removeChild(record.dom); nodes.delete(id) }
    // A style text may have been constructed before its parent existed.
    for (const record of nodes.values()) if (record.content.kind === 'text' && record.dom.parentElement?.tagName === 'STYLE') record.dom.nodeValue = resolveStyleText(record.content.text)
    ensureHostStyle()
    paintLeaves(); scheduleLayout()
  }
  const select = (event: PointerEvent) => {
    if (options.mode !== 'authoring') return
    const element = (event.target as Element | null)?.closest?.('[data-composition-node]')
    const id = element?.getAttribute('data-composition-node')
    if (!id) return
    const bounds = measure(id)
    if (bounds) options.onSelection?.({ layerItemId: options.instanceId, nodeId: id, bounds })
    event.preventDefault(); event.stopPropagation()
  }
  const preventAuthoringAction = (event: MouseEvent) => {
    if (options.mode === 'authoring') { event.preventDefault(); event.stopPropagation() }
  }
  const loaded = new Promise<void>((resolve, reject) => {
    finishLoad = resolve
    iframe.addEventListener('load', () => {
      if (destroyed) { resolve(); return }
      try {
        dom = iframe.contentDocument
        if (!dom?.defaultView) throw new Error('组合内容没有可用的排版文档')
        const Resize = dom.defaultView.ResizeObserver
        observer = new Resize(() => scheduleLayout())
        dom.replaceChildren()
        if (current.doctype) dom.appendChild(dom.implementation.createDocumentType('html', '', ''))
        dom.addEventListener('pointerdown', select, true)
        dom.addEventListener('click', preventAuthoringAction, true)
        apply(current)
        resolve()
      } catch (error) { reject(fail(error)) }
    }, { once: true })
  })
  iframe.srcdoc = '<!doctype html><html><head></head><body></body></html>'
  parent.append(iframe)
  async function waitForReady(): Promise<void> {
    await loaded
    if (destroyed) throw new Error('组合内容已销毁')
    if (failure) throw failure
    await dom?.fonts?.ready
    await Promise.all([...nodes.values()].map(record => record.embedded?.ready))
    paintLeaves()
    await Promise.all([...nodes.values()].map(record => record.runtime?.waitForReady()))
    await Promise.all(componentHandles().map(handle => handle.waitForReady().catch(error => reportLeafError(handle.element, error instanceof Error ? error : new Error(String(error))))))
    await new Promise<void>(resolve => dom!.defaultView!.requestAnimationFrame(() => resolve()))
    if (failure) throw failure
  }
  const ready = waitForReady()
  void ready.catch(error => { if (!destroyed) fail(error) })
  const handle: WebCompositionMountHandle = {
    ready, element: iframe, measure, observeLayout, describeInput, bindInputSubmit,
    async update(content) { await loaded; if (destroyed) return; try { apply(content); await waitForReady() } catch (error) { throw fail(error) } },
    resize(width, height) { iframe.style.width = `${width}px`; iframe.style.height = `${height}px`; scheduleLayout() },
    waitForReady, waitForObservationReady: waitForReady,
    async waitForCaptureReady() { await waitForReady(); await Promise.all([...nodes.values()].map(record => record.runtime?.waitForCaptureReady())); await Promise.all(componentHandles().filter(handle => handle.ok).map(handle => handle.waitForCaptureReady())) },
    restoreAfterCapture() { for (const record of nodes.values()) record.runtime?.restoreAfterCapture(); for (const handle of componentHandles()) handle.restoreAfterCapture() },
    setVisible(next) { visible = next; iframe.style.visibility = next ? 'visible' : 'hidden'; for (const record of nodes.values()) record.runtime?.setVisible(next); for (const handle of componentHandles()) handle.setVisible(next) },
    suspend() { suspended = true; for (const record of nodes.values()) record.runtime?.suspend(); for (const handle of componentHandles()) handle.suspend() },
    resume() { suspended = false; for (const record of nodes.values()) record.runtime?.resume(); for (const handle of componentHandles()) handle.resume() },
    destroy() {
      if (destroyed) return
      destroyed = true; unregister(); observer?.disconnect()
      finishLoad?.()
      if (frame) dom?.defaultView?.cancelAnimationFrame(frame)
      dom?.removeEventListener('pointerdown', select, true)
      dom?.removeEventListener('click', preventAuthoringAction, true)
      for (const record of nodes.values()) destroyNode(record)
      nodes.clear(); inputListeners.clear(); iframe.remove()
    },
  }
  const unregister = registerPublishedCaptureResource(parent, handle)
  handle.setVisible(visible)
  return handle
}
