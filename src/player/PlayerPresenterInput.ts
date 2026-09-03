import type {
  PresenterCommand,
  PresenterKeyBinding,
  ProjectPresenterSettings,
} from '../shared/contracts/playback-v1'

const DEFAULT_DEDUPE_MS = 120

export interface PresenterInputResult {
  accepted: boolean
  message?: string
}

export interface PresenterInputFeedback {
  command: PresenterCommand
  source: 'keyboard-navigation' | 'presenter-standard' | 'presenter-additional'
  message: string
}

export interface PlayerPresenterInputOptions {
  totalPages: number
  keyboardNavigation: boolean
  presenter: Readonly<ProjectPresenterSettings>
  onNavigate(targetIndex: number, command: PresenterCommand): boolean | PresenterInputResult
  onAuthoredCommand(command: PresenterCommand): boolean | PresenterInputResult
  onFeedback?(feedback: PresenterInputFeedback): void
  isModalOpen?(): boolean
  /** Authoritative delivery-time index when navigation can also come from other controls. */
  readCurrentIndex?(): number
  /** Injectable only so the hardware de-duplication window stays deterministic in tests. */
  now?(): number
  dedupeMs?: number
}

interface ResolvedInput {
  command: PresenterCommand
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

function inputSignature(event: KeyboardEvent): string {
  return [
    event.key,
    event.altKey,
    event.ctrlKey,
    event.shiftKey,
    event.metaKey,
  ].join('\0')
}

function isKeyboardOwnedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'slider'
  ) {
    return true
  }

  return Boolean(target.closest([
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    '[role="slider"]',
    '[data-courseware-keyboard-capture="true"]',
  ].join(', ')))
}

function isKeyboardOwnedEvent(event: KeyboardEvent): boolean {
  // Events leaving a shadow root are retargeted to its host. The composed path
  // retains the actual editable/control node and is therefore authoritative.
  return event.composedPath().some(isKeyboardOwnedTarget)
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
 * Owns every delivery-time scene navigation key. Direction keys remain an
 * independent author setting, while PageUp/PageDown and additional bindings
 * follow the Project V8 presenter strategy.
 */
export class PlayerPresenterInput {
  private readonly totalPages: number
  private readonly keyboardNavigation: boolean
  private readonly presenter: Readonly<ProjectPresenterSettings>
  private readonly onNavigate: PlayerPresenterInputOptions['onNavigate']
  private readonly onAuthoredCommand: PlayerPresenterInputOptions['onAuthoredCommand']
  private readonly onFeedback: PlayerPresenterInputOptions['onFeedback']
  private readonly isModalOpen: () => boolean
  private readonly readCurrentIndex?: PlayerPresenterInputOptions['readCurrentIndex']
  private readonly now: () => number
  private readonly dedupeMs: number
  private currentIndex = 0
  private lastSignature: string | null = null
  private lastAcceptedAt = Number.NEGATIVE_INFINITY
  private destroyed = false

  constructor(options: PlayerPresenterInputOptions) {
    this.totalPages = Math.max(1, Math.trunc(options.totalPages))
    this.keyboardNavigation = options.keyboardNavigation
    this.presenter = options.presenter
    this.onNavigate = options.onNavigate
    this.onAuthoredCommand = options.onAuthoredCommand
    this.onFeedback = options.onFeedback
    this.isModalOpen = options.isModalOpen ?? (() => false)
    this.readCurrentIndex = options.readCurrentIndex
    this.now = options.now ?? (() => performance.now())
    this.dedupeMs = Math.max(0, options.dedupeMs ?? DEFAULT_DEDUPE_MS)
    window.addEventListener('keydown', this.handleKeyDown)
  }

  setIndex(index: number): void {
    if (!Number.isFinite(index)) return
    this.currentIndex = Math.min(
      Math.max(0, Math.trunc(index)),
      this.totalPages - 1,
    )
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('keydown', this.handleKeyDown)
  }

  private currentIndexAtDelivery(): number {
    const candidate = this.readCurrentIndex?.()
    if (candidate === undefined || !Number.isFinite(candidate)) return this.currentIndex
    this.currentIndex = Math.min(
      Math.max(0, Math.trunc(candidate)),
      this.totalPages - 1,
    )
    return this.currentIndex
  }

  private resolveInput(event: KeyboardEvent): ResolvedInput | null {
    const signature = inputSignature(event)
    if (this.presenter.enabled) {
      if (noModifiers(event) && event.key === 'PageDown') {
        return { command: 'next', source: 'presenter-standard', signature }
      }
      if (noModifiers(event) && event.key === 'PageUp') {
        return { command: 'previous', source: 'presenter-standard', signature }
      }
      const binding = this.presenter.additionalBindings.find(
        (candidate) => candidate.key === event.key && exactModifiers(event, candidate),
      )
      if (binding) {
        return {
          command: binding.command,
          source: 'presenter-additional',
          signature,
        }
      }
    }

    if (this.keyboardNavigation && noModifiers(event)) {
      if (event.key === 'ArrowRight') {
        return { command: 'next', source: 'keyboard-navigation', signature }
      }
      if (event.key === 'ArrowLeft') {
        return { command: 'previous', source: 'keyboard-navigation', signature }
      }
    }
    return null
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (
      this.destroyed ||
      event.defaultPrevented ||
      event.isComposing ||
      isKeyboardOwnedEvent(event) ||
      this.isModalOpen()
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

    let result: PresenterInputResult
    if (input.source === 'keyboard-navigation' ||
      this.presenter.strategy === 'scene-navigation') {
      const currentIndex = this.currentIndexAtDelivery()
      const targetIndex = input.command === 'next'
        ? currentIndex + 1
        : currentIndex - 1
      if (targetIndex < 0 || targetIndex >= this.totalPages) {
        result = {
          accepted: false,
          message: input.command === 'next'
            ? '已经是最后一个场景'
            : '已经是第一个场景',
        }
      } else {
        result = normalizeResult(
          this.onNavigate(targetIndex, input.command),
          input.command === 'next' ? '无法前进到下一场景' : '无法返回上一场景',
        )
      }
    } else {
      result = normalizeResult(
        this.onAuthoredCommand(input.command),
        input.command === 'next'
          ? '当前场景没有可执行的“前进”规则'
          : '当前场景没有可执行的“后退”规则',
      )
    }

    if (!result.accepted) {
      this.onFeedback?.({
        command: input.command,
        source: input.source,
        message: result.message ?? '演示命令未执行',
      })
    }
  }
}
