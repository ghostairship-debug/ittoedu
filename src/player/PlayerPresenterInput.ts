import type {
  PresenterCommand,
  PresenterKeyBinding,
  ProjectPresenterSettings,
} from '../shared/contracts/playback-v1'

const DEFAULT_DEDUPE_MS = 120

/**
 * What a recognized key asks the course to do: a step or a scene forward/back,
 * or the first/last page (the first step of the first/last scene).
 */
export type PlaybackKeyCommand =
  | { readonly kind: 'step' | 'scene'; readonly direction: PresenterCommand }
  | { readonly kind: 'edge'; readonly edge: 'first' | 'last' }

export interface PresenterInputResult {
  accepted: boolean
  message?: string
}

export interface PresenterInputFeedback {
  command: PlaybackKeyCommand
  source: 'keyboard-navigation' | 'presenter-standard' | 'presenter-additional'
  message: string
}

export interface PlayerPresenterInputOptions {
  /** The playback stage. Keys are heard on its window and inside the same-origin frames it contains. */
  root: HTMLElement
  keyboardNavigation: boolean
  presenter: Readonly<ProjectPresenterSettings>
  /** The playback session judges its own boundaries, guards and pending navigation. */
  navigate(command: PlaybackKeyCommand): boolean | PresenterInputResult
  onAuthoredCommand(command: PresenterCommand): boolean | PresenterInputResult
  onFeedback?(feedback: PresenterInputFeedback): void
  /** Injectable only so the hardware de-duplication window stays deterministic in tests. */
  now?(): number
  dedupeMs?: number
}

interface ResolvedInput {
  command: PlaybackKeyCommand
  /** Presenter keys follow the project's presenter strategy; keyboard keys always navigate. */
  presenterCommand?: PresenterCommand
  source: PresenterInputFeedback['source']
  signature: string
}

function exactModifiers(
  event: KeyboardEvent,
  binding: Pick<
    PresenterKeyBinding,
    'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'
  >,
): boolean {
  return event.altKey === binding.altKey &&
    event.ctrlKey === binding.ctrlKey &&
    event.shiftKey === binding.shiftKey &&
    event.metaKey === binding.metaKey
}

function noModifiers(event: KeyboardEvent): boolean {
  return !event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey
}

/** ←/→ step, Shift+←/→ scene, Home/End first/last page. Every other modifier combination is left alone. */
function keyboardCommand(event: KeyboardEvent): PlaybackKeyCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    return { kind: event.shiftKey ? 'scene' : 'step', direction: event.key === 'ArrowRight' ? 'next' : 'previous' }
  }
  if (event.shiftKey) return null
  if (event.key === 'Home') return { kind: 'edge', edge: 'first' }
  if (event.key === 'End') return { kind: 'edge', edge: 'last' }
  return null
}

function rejectedMessage(command: PlaybackKeyCommand): string {
  if (command.kind === 'edge') return command.edge === 'first' ? '已在第一页或当前无法跳转' : '已在最后一页或当前无法跳转'
  if (command.kind === 'scene') return command.direction === 'next' ? '已是最后一个场景或当前无法继续' : '已是第一个场景或当前无法返回'
  return command.direction === 'next' ? '已到整课末尾或当前无法继续' : '已到整课开头或当前无法返回'
}

function inputSignature(event: KeyboardEvent): string {
  return [
    event.key,
    event.altKey,
    event.ctrlKey,
    event.shiftKey,
    event.metaKey,
  ].join('\0')
}

const KEYBOARD_CAPTURE = '[data-courseware-keyboard-capture="true"]'

// Element checks avoid instanceof: a key typed inside a page or component frame comes from another window.
function isKeyboardOwnedTarget(target: EventTarget | null): boolean {
  const element = target as Element | null
  if (!element || element.nodeType !== 1) return false

  if (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    (element as HTMLElement).isContentEditable ||
    element.getAttribute('role') === 'slider'
  ) {
    return true
  }

  return Boolean(element.closest([
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="slider"]',
    KEYBOARD_CAPTURE,
  ].join(', ')))
}

function isKeyboardOwnedEvent(event: KeyboardEvent): boolean {
  // Events leaving a shadow root are retargeted to its host. The composed path
  // retains the actual editable/control node and is therefore authoritative.
  return event.composedPath().some(isKeyboardOwnedTarget)
}

/** A frame placed inside content that keeps the keyboard for itself. */
function insideKeyboardCapture(element: Element): boolean {
  for (let node: Node | null = element; node; node = node.parentNode ?? (node as ShadowRoot).host ?? null) {
    if (node.nodeType === 1 && (node as Element).matches(KEYBOARD_CAPTURE)) return true
  }
  return false
}

function composedContains(root: Element, node: Node): boolean {
  for (let current: Node | null = node; current; current = current.parentNode ?? (current as ShadowRoot).host ?? null) {
    if (current === root) return true
  }
  return false
}

/** The frame that holds the document's focus, looking through open shadow roots. */
function focusedFrame(document: Document): HTMLIFrameElement | null {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active?.localName === 'iframe' ? active as HTMLIFrameElement : null
}

function normalizeResult(
  result: boolean | PresenterInputResult,
  fallbackMessage: string,
): PresenterInputResult {
  if (typeof result !== 'boolean') {
    return result.accepted || result.message
      ? result
      : { accepted: false, message: fallbackMessage }
  }
  return result
    ? { accepted: true }
    : { accepted: false, message: fallbackMessage }
}

/**
 * Hears keydown on a window after every listener its content registered, even
 * ones added later: content decides first whether a key is its own.
 */
function listenAfterContent(view: Window, handler: (event: KeyboardEvent) => void): () => void {
  const queue = () => {
    view.removeEventListener('keydown', handler)
    view.addEventListener('keydown', handler)
  }
  view.addEventListener('keydown', queue, true)
  return () => {
    view.removeEventListener('keydown', queue, true)
    view.removeEventListener('keydown', handler)
  }
}

interface BridgedFrame {
  readonly frame: HTMLIFrameElement
  readonly window: Window
  readonly document: Document
  dispose(): void
}

/**
 * The one course key handler of the exported player, the editor's whole-course
 * preview and its try-runs. ←/→ and Shift+←/→ and Home/End belong to the
 * keyboard-navigation setting; PageUp/PageDown and additional bindings follow
 * the project presenter strategy. Keys stay with inputs, editable content, IME
 * composition and content that handled them. A key typed inside a same-origin
 * page, component or Runtime frame of the stage is handled here once the frame
 * has left it alone.
 */
export class PlayerPresenterInput {
  private readonly root: HTMLElement
  private readonly window: Window
  private readonly keyboardNavigation: boolean
  private readonly presenter: Readonly<ProjectPresenterSettings>
  private readonly navigate: PlayerPresenterInputOptions['navigate']
  private readonly onAuthoredCommand: PlayerPresenterInputOptions['onAuthoredCommand']
  private readonly onFeedback: PlayerPresenterInputOptions['onFeedback']
  private readonly now: () => number
  private readonly dedupeMs: number
  private readonly stopKeys: () => void
  private frames: BridgedFrame[] = []
  private lastSignature: string | null = null
  private lastAcceptedAt = Number.NEGATIVE_INFINITY
  private destroyed = false

  constructor(options: PlayerPresenterInputOptions) {
    const view = options.root.ownerDocument.defaultView
    if (!view) throw new Error('播放按键需要已挂载的播放舞台')
    this.root = options.root
    this.window = view
    this.keyboardNavigation = options.keyboardNavigation
    this.presenter = options.presenter
    this.navigate = options.navigate
    this.onAuthoredCommand = options.onAuthoredCommand
    this.onFeedback = options.onFeedback
    this.now = options.now ?? (() => performance.now())
    this.dedupeMs = Math.max(0, options.dedupeMs ?? DEFAULT_DEDUPE_MS)
    this.stopKeys = listenAfterContent(view, this.handleKeyDown)
    this.watchFocus(view)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopKeys()
    this.unwatchFocus(this.window)
    for (const frame of this.frames.splice(0)) frame.dispose()
  }

  private resolveInput(event: KeyboardEvent): ResolvedInput | null {
    const signature = inputSignature(event)
    if (this.presenter.enabled) {
      if (noModifiers(event) && (event.key === 'PageDown' || event.key === 'PageUp')) {
        const direction = event.key === 'PageDown' ? 'next' : 'previous'
        return { command: { kind: 'step', direction }, presenterCommand: direction, source: 'presenter-standard', signature }
      }
      const binding = this.presenter.additionalBindings.find(
        (candidate) => candidate.key === event.key && exactModifiers(event, candidate),
      )
      if (binding) {
        return {
          command: { kind: 'step', direction: binding.command },
          presenterCommand: binding.command,
          source: 'presenter-additional',
          signature,
        }
      }
    }

    const command = this.keyboardNavigation ? keyboardCommand(event) : null
    return command ? { command, source: 'keyboard-navigation', signature } : null
  }

  /** Keys belong to the course only while its stage is live: shown, not inert and not behind another modal dialog. */
  private blocked(): boolean {
    if (!this.root.isConnected || this.root.closest('[inert], [hidden]')) return true
    for (const dialog of this.root.ownerDocument.querySelectorAll('[aria-modal="true"]')) {
      if (!dialog.contains(this.root) && !this.root.contains(dialog) && !dialog.closest('[hidden]')) return true
    }
    return false
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.handle(event, null)
  }

  /**
   * Keys from the stage, from no particular element or from a plain button (such
   * as the run switch) belong to the course. Other regions of a host page, like a
   * scrolling panel of the editor beside a try-run, keep theirs.
   */
  private fromStage(event: KeyboardEvent): boolean {
    const element = (event.composedPath()[0] ?? event.target) as Element | null
    if (!element || element.nodeType !== 1 || composedContains(this.root, element)) return true
    return element.localName === 'body' || element.localName === 'html' || element.localName === 'button'
  }

  private handle(event: KeyboardEvent, frame: Element | null): void {
    if (
      this.destroyed ||
      event.defaultPrevented ||
      event.isComposing ||
      isKeyboardOwnedEvent(event) ||
      (frame === null ? !this.fromStage(event) : insideKeyboardCapture(frame)) ||
      this.blocked()
    ) {
      return
    }

    const input = this.resolveInput(event)
    if (!input) return

    // Recognized navigation keys must not scroll the document even when a
    // long press, hardware bounce, boundary, or navigation guard rejects them.
    event.preventDefault()
    if (event.repeat) return

    const now = this.now()
    if (
      input.signature === this.lastSignature &&
      now - this.lastAcceptedAt < this.dedupeMs
    ) {
      return
    }
    this.lastSignature = input.signature
    this.lastAcceptedAt = now

    const result = input.presenterCommand && this.presenter.strategy === 'authored-command'
      ? normalizeResult(
          this.onAuthoredCommand(input.presenterCommand),
          input.presenterCommand === 'next'
            ? '当前场景没有可执行的“前进”规则'
            : '当前场景没有可执行的“后退”规则',
        )
      : normalizeResult(this.navigate(input.command), rejectedMessage(input.command))

    if (!result.accepted) {
      this.onFeedback?.({
        command: input.command,
        source: input.source,
        message: result.message ?? '演示命令未执行',
      })
    }
  }

  // Focus moving into a frame blurs the window that held it: the stage window, or a
  // bridged frame when focus goes on to another frame. Once focus has settled, every
  // frame on the focused chain inside the stage is bridged.
  private watchFocus(view: Window): void {
    view.addEventListener('blur', this.handleFocusMove)
  }

  private unwatchFocus(view: Window): void {
    view.removeEventListener('blur', this.handleFocusMove)
  }

  private readonly handleFocusMove = (): void => {
    this.window.setTimeout(() => {
      if (this.destroyed) return
      let document: Document | null = this.window.document
      for (let frame = focusedFrame(document); frame; frame = document ? focusedFrame(document) : null) {
        if (document === this.window.document && !composedContains(this.root, frame)) return
        document = this.bridge(frame)
      }
    }, 0)
  }

  /** Hears keys inside one same-origin frame of the stage; returns its document, or null for a cross-origin frame. */
  private bridge(frame: HTMLIFrameElement): Document | null {
    const view = frame.contentWindow
    let document: Document
    try {
      if (!view) return null
      document = view.document
    } catch {
      return null // A cross-origin frame keeps its keys.
    }
    if (this.frames.some(entry => entry.frame === frame && entry.window === view && entry.document === document)) return document
    // Frames of earlier scenes, and documents a frame has since replaced, are let go.
    this.frames = this.frames.filter((entry) => {
      const current = entry.frame.isConnected && entry.frame.contentWindow === entry.window && entry.frame.contentDocument === entry.document
      if (!current) entry.dispose()
      return current
    })
    const stopKeys = listenAfterContent(view, event => this.handle(event, frame))
    this.watchFocus(view)
    this.frames.push({
      frame,
      window: view,
      document,
      dispose: () => {
        stopKeys()
        this.unwatchFocus(view)
      },
    })
    return document
  }
}
