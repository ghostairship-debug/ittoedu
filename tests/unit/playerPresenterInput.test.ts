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
  root: HTMLElement
  navigate: ReturnType<typeof vi.fn>
  authored: ReturnType<typeof vi.fn>
  feedback: ReturnType<typeof vi.fn>
} {
  const root = mount(document.createElement('div'))
  const navigate = vi.fn(() => true)
  const authored = vi.fn(() => true)
  const feedback = vi.fn()
  const input = new PlayerPresenterInput({
    root,
    keyboardNavigation: true,
    presenter: {
      enabled: true,
      strategy: 'scene-navigation',
      additionalBindings: [],
    },
    navigate,
    onAuthoredCommand: authored,
    onFeedback: feedback,
    dedupeMs: 0,
    ...patch,
  })
  inputs.push(input)
  return { input, root, navigate, authored, feedback }
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
  it('maps ←/→ and PageUp/PageDown to steps, Shift+←/→ to scenes and Home/End to the first and last page', () => {
    const { navigate } = createInput()
    for (const [key, init] of [
      ['ArrowRight', {}], ['ArrowLeft', {}], ['PageDown', {}], ['PageUp', {}],
      ['ArrowRight', { shiftKey: true }], ['ArrowLeft', { shiftKey: true }], ['Home', {}], ['End', {}],
    ] as const) {
      expect(keydown(key, init).defaultPrevented).toBe(true)
    }
    expect(navigate.mock.calls.map(([command]) => command)).toEqual([
      { kind: 'step', direction: 'next' }, { kind: 'step', direction: 'previous' },
      { kind: 'step', direction: 'next' }, { kind: 'step', direction: 'previous' },
      { kind: 'scene', direction: 'next' }, { kind: 'scene', direction: 'previous' },
      { kind: 'edge', edge: 'first' }, { kind: 'edge', edge: 'last' },
    ])
  })

  it('leaves every other modifier combination alone', () => {
    const { navigate } = createInput()
    for (const [key, init] of [
      ['ArrowRight', { ctrlKey: true }], ['ArrowLeft', { altKey: true }], ['ArrowRight', { metaKey: true }],
      ['ArrowRight', { shiftKey: true, ctrlKey: true }], ['Home', { shiftKey: true }], ['End', { ctrlKey: true }],
      ['PageDown', { shiftKey: true }],
    ] as const) {
      expect(keydown(key, init).defaultPrevented).toBe(false)
    }
    expect(navigate).not.toHaveBeenCalled()
  })

  it('keeps keyboard keys independent of presenter controls', () => {
    const presenterOff = createInput({
      presenter: { enabled: false, strategy: 'scene-navigation', additionalBindings: [] },
    })
    expect(keydown('PageDown').defaultPrevented).toBe(false)
    expect(keydown('End').defaultPrevented).toBe(true)
    expect(presenterOff.navigate.mock.calls).toEqual([[{ kind: 'edge', edge: 'last' }]])
    presenterOff.input.destroy()

    const keyboardOff = createInput({ keyboardNavigation: false })
    for (const key of ['ArrowRight', 'Home', 'End']) expect(keydown(key).defaultPrevented).toBe(false)
    expect(keydown('ArrowRight', { shiftKey: true }).defaultPrevented).toBe(false)
    expect(keydown('PageDown').defaultPrevented).toBe(true)
    expect(keyboardOff.navigate.mock.calls).toEqual([[{ kind: 'step', direction: 'next' }]])
  })

  it('dispatches presenter keys as authored commands while keyboard keys still navigate', () => {
    const { navigate, authored } = createInput({
      presenter: {
        enabled: true,
        strategy: 'authored-command',
        additionalBindings: [],
      },
    })

    keydown('PageDown')
    keydown('PageUp')
    keydown('ArrowRight')

    expect(authored).toHaveBeenNthCalledWith(1, 'next')
    expect(authored).toHaveBeenNthCalledWith(2, 'previous')
    expect(navigate.mock.calls).toEqual([[{ kind: 'step', direction: 'next' }]])
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
    const { navigate } = createInput({
      keyboardNavigation: false,
      presenter: {
        enabled: true,
        strategy: 'scene-navigation',
        additionalBindings: [{
          id: 'remote-control-page-down',
          command: 'previous',
          key: 'PageDown',
          altKey: false,
          ctrlKey: true,
          shiftKey: false,
          metaKey: false,
        }],
      },
    })

    keydown('PageDown')
    keydown('PageDown', { ctrlKey: true })
    expect(navigate.mock.calls).toEqual([[{ kind: 'step', direction: 'next' }], [{ kind: 'step', direction: 'previous' }]])
  })

  it('reports rejected navigation without scrolling the document', () => {
    const { navigate, feedback } = createInput()
    navigate.mockReturnValue(false)

    expect(keydown('PageUp').defaultPrevented).toBe(true)
    expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({
      command: { kind: 'step', direction: 'previous' },
      message: '已到整课开头或当前无法返回',
    }))
    keydown('ArrowRight', { shiftKey: true })
    expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ message: '已是最后一个场景或当前无法继续' }))
    keydown('Home')
    expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ message: '已在第一页或当前无法跳转' }))
    navigate.mockReturnValue({ accepted: false, message: '请先完成练习' })
    keydown('End')
    expect(feedback).toHaveBeenLastCalledWith(expect.objectContaining({ message: '请先完成练习' }))
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
  ])('does not steal course keys from %s', (_label, target) => {
    const { navigate } = createInput()
    mount(target)

    expect(keydown('PageDown', {}, target).defaultPrevented).toBe(false)
    expect(keydown('Home', {}, target).defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('uses the composed path so course keys stay inside Shadow DOM inputs', () => {
    const { navigate } = createInput()
    const host = mount(document.createElement('div'))
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    shadowRoot.append(input)

    const event = keydown('ArrowRight', { composed: true, shiftKey: true }, input)

    expect(event.defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('respects content keyboard ownership, content that handled the key and composition', () => {
    const { navigate } = createInput()
    const component = mount(document.createElement('div'))
    const child = document.createElement('button')
    component.dataset.coursewareKeyboardCapture = 'true'
    component.append(child)
    const handled = mount(document.createElement('button'))
    handled.addEventListener('keydown', event => event.preventDefault())

    keydown('PageDown', {}, child)
    keydown('ArrowRight', {}, handled)
    keydown('PageDown', { isComposing: true })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('stays out of the way while its stage is inert, hidden or behind another modal dialog', () => {
    const { root, navigate } = createInput()
    root.setAttribute('inert', '')
    expect(keydown('ArrowRight').defaultPrevented).toBe(false)
    root.removeAttribute('inert')
    root.hidden = true
    expect(keydown('ArrowRight').defaultPrevented).toBe(false)
    root.hidden = false

    const dialog = mount(document.createElement('section'))
    dialog.setAttribute('aria-modal', 'true')
    expect(keydown('ArrowRight').defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()

    // The course's own scene directory is a modal inside the stage.
    root.append(dialog)
    expect(keydown('ArrowRight').defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('leaves keys to other regions of a host page beside the stage', () => {
    const { root, navigate } = createInput()
    const stageControl = document.createElement('div')
    stageControl.tabIndex = 0
    root.append(stageControl)
    const panel = mount(document.createElement('div'))
    panel.tabIndex = 0
    const runSwitch = mount(document.createElement('button'))

    expect(keydown('End', {}, panel).defaultPrevented).toBe(false)
    expect(keydown('PageDown', {}, panel).defaultPrevented).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(keydown('End', {}, stageControl).defaultPrevented).toBe(true)
    expect(keydown('ArrowRight', {}, runSwitch).defaultPrevented).toBe(true)
    expect(keydown('ArrowLeft', {}, document.body).defaultPrevented).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(3)
  })

  it('removes its listener on destroy', () => {
    const { input, navigate } = createInput()
    input.destroy()

    keydown('PageDown')

    expect(navigate).not.toHaveBeenCalled()
  })
})
