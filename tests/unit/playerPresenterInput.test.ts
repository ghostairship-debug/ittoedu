import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PlayerPresenterInput,
  type PlayerPresenterInputOptions,
} from '../../src/player/PlayerPresenterInput'

const mounted: HTMLElement[] = []
const inputs: PlayerPresenterInput[] = []

function mount<T extends HTMLElement>(element: T): T {
  document.body.append(element)
  mounted.push(element)
  return element
}

function createInput(
  patch: Partial<PlayerPresenterInputOptions> = {},
): {
  input: PlayerPresenterInput
  navigate: ReturnType<typeof vi.fn>
  authored: ReturnType<typeof vi.fn>
  feedback: ReturnType<typeof vi.fn>
} {
  const navigate = vi.fn(() => true)
  const authored = vi.fn(() => true)
  const feedback = vi.fn()
  const input = new PlayerPresenterInput({
    totalPages: 3,
    keyboardNavigation: true,
    presenter: {
      enabled: true,
      strategy: 'scene-navigation',
      additionalBindings: [],
    },
    onNavigate: navigate,
    onAuthoredCommand: authored,
    onFeedback: feedback,
    dedupeMs: 0,
    ...patch,
  })
  inputs.push(input)
  return { input, navigate, authored, feedback }
}

function keydown(
  key: string,
  init: KeyboardEventInit = {},
  target: HTMLElement | Window = window,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  inputs.splice(0).forEach((input) => input.destroy())
  mounted.splice(0).forEach((element) => element.remove())
})

describe('PlayerPresenterInput', () => {
  it('keeps Arrow navigation independent and maps standard presenter keys', () => {
    const { input, navigate, authored } = createInput()

    expect(keydown('ArrowRight').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenLastCalledWith(1, 'next')

    input.setIndex(1)
    expect(keydown('PageDown').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenLastCalledWith(2, 'next')

    expect(keydown('PageUp').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenLastCalledWith(0, 'previous')
    expect(authored).not.toHaveBeenCalled()
  })

  it('keeps Arrow keys enabled when presenter controls are disabled', () => {
    const { navigate } = createInput({
      keyboardNavigation: true,
      presenter: {
        enabled: false,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    })

    expect(keydown('PageDown').defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(keydown('ArrowRight').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledWith(1, 'next')
  })

  it('dispatches authored commands without an implicit scene fallback', () => {
    const { navigate, authored } = createInput({
      keyboardNavigation: false,
      presenter: {
        enabled: true,
        strategy: 'authored-command',
        additionalBindings: [],
      },
    })

    keydown('PageDown')
    keydown('PageUp')

    expect(authored).toHaveBeenNthCalledWith(1, 'next')
    expect(authored).toHaveBeenNthCalledWith(2, 'previous')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('matches additional bindings by key and the complete modifier signature', () => {
    const { authored } = createInput({
      keyboardNavigation: false,
      presenter: {
        enabled: true,
        strategy: 'authored-command',
        additionalBindings: [{
          id: 'remote-blue',
          command: 'next',
          key: 'b',
          altKey: true,
          ctrlKey: false,
          shiftKey: true,
          metaKey: false,
        }],
      },
    })

    keydown('b', { altKey: true })
    expect(authored).not.toHaveBeenCalled()

    const matched = keydown('b', { altKey: true, shiftKey: true })
    expect(matched.defaultPrevented).toBe(true)
    expect(authored).toHaveBeenCalledWith('next')
  })

  it('allows modified PageUp/PageDown as exact additional bindings', () => {
    const { authored } = createInput({
      keyboardNavigation: false,
      presenter: {
        enabled: true,
        strategy: 'authored-command',
        additionalBindings: [{
          id: 'remote-control-page-down',
          command: 'next',
          key: 'PageDown',
          altKey: false,
          ctrlKey: true,
          shiftKey: false,
          metaKey: false,
        }],
      },
    })

    keydown('PageDown')
    expect(authored).toHaveBeenCalledTimes(1)
    keydown('PageDown', { ctrlKey: true })
    expect(authored).toHaveBeenCalledTimes(2)
  })

  it('reports boundaries and rejected navigation without scrolling the document', () => {
    const { input, navigate, feedback } = createInput()

    const first = keydown('PageUp')
    expect(first.defaultPrevented).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({
      command: 'previous',
      message: '已经是第一个场景',
    }))

    input.setIndex(1)
    navigate.mockReturnValue(false)
    keydown('PageDown')
    expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({
      command: 'next',
      message: '无法前进到下一场景',
    }))
  })

  it('reads the authoritative index after another course control navigates', () => {
    let currentIndex = 0
    const { navigate } = createInput({ readCurrentIndex: () => currentIndex })

    currentIndex = 1
    expect(keydown('ArrowLeft').defaultPrevented).toBe(true)

    expect(navigate).toHaveBeenCalledWith(0, 'previous')
  })

  it('ignores repeat and hardware bounce inside the de-duplication window', () => {
    let now = 1000
    const { authored } = createInput({
      keyboardNavigation: false,
      presenter: {
        enabled: true,
        strategy: 'authored-command',
        additionalBindings: [],
      },
      dedupeMs: 120,
      now: () => now,
    })

    keydown('PageDown')
    keydown('PageDown')
    keydown('PageDown', { repeat: true })
    expect(authored).toHaveBeenCalledTimes(1)

    now += 121
    keydown('PageDown')
    expect(authored).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['input', document.createElement('input')],
    ['textarea', document.createElement('textarea')],
    ['select', document.createElement('select')],
  ])('does not steal presenter keys from %s', (_label, target) => {
    const { navigate } = createInput()
    mount(target)

    const event = keydown('PageDown', {}, target)

    expect(event.defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('uses the composed path so presenter keys stay inside Shadow DOM inputs', () => {
    const { navigate } = createInput()
    const host = mount(document.createElement('div'))
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    shadowRoot.append(input)

    const event = keydown('PageDown', { composed: true }, input)

    expect(event.defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('respects component keyboard ownership, composition, and open modals', () => {
    let modalOpen = false
    const { navigate } = createInput({ isModalOpen: () => modalOpen })
    const component = mount(document.createElement('div'))
    const child = document.createElement('button')
    component.dataset.coursewareKeyboardCapture = 'true'
    component.append(child)

    keydown('PageDown', {}, child)
    keydown('PageDown', { isComposing: true })
    modalOpen = true
    keydown('PageDown')

    expect(navigate).not.toHaveBeenCalled()
  })

  it('removes its listener on destroy', () => {
    const { input, navigate } = createInput()
    input.destroy()

    keydown('PageDown')

    expect(navigate).not.toHaveBeenCalled()
  })
})
