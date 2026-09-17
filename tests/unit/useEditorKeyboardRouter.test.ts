import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEditorKeyboardRouter, type EditorKeyboardActionPorts } from '@/renderer/app/useEditorKeyboardRouter'

function createPorts(): EditorKeyboardActionPorts {
  return {
    isReadOnly: vi.fn(() => false),
    captureDeleteSnapshot: vi.fn(() => ({
      hasCourseProject: false, selection: null, contentEditable: false,
      hasFlowSession: false, flowComposing: false, flowTextFocus: false,
      flowHasSelection: false, hasSlideBackend: false, slideTextEdit: false,
      slideFormulaEdit: false, selectedNodeCount: 1, editingText: false,
    })),
    routeEditorAction: vi.fn(() => ({ ok: true, reason: 'deleted' })),
    deleteSelectedNodes: vi.fn(), copySelection: vi.fn(), pasteClipboard: vi.fn(),
    duplicateSelection: vi.fn(), nudgeSelection: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    selectAll: vi.fn(), clearSelection: vi.fn(), selectedCount: vi.fn(() => 1),
    saveProject: vi.fn(), newProject: vi.fn(), openProject: vi.fn(),
  }
}

function key(target: EventTarget, value: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: value, bubbles: true, composed: true, cancelable: true, ...init,
  })
  target.dispatchEvent(event)
  return event
}

function expectNoEditorActions(ports: EditorKeyboardActionPorts): void {
  for (const [name, port] of Object.entries(ports)) {
    if (name !== 'isReadOnly') expect(port, name).not.toHaveBeenCalled()
  }
}

afterEach(() => { cleanup(); document.body.replaceChildren() })

describe('editor keyboard ownership', () => {
  it('keeps composed shadow textarea shortcuts inside the input', () => {
    const ports = createPorts()
    renderHook(() => useEditorKeyboardRouter(ports))
    const host = document.createElement('div')
    document.body.append(host)
    const input = document.createElement('textarea')
    host.attachShadow({ mode: 'open' }).append(input)
    input.focus()
    let outsideTarget: EventTarget | null = null
    window.addEventListener('keydown', event => { outsideTarget = event.target }, { once: true })
    expect(key(input, 'a', { ctrlKey: true }).defaultPrevented).toBe(false)
    expect(outsideTarget).toBe(host)
    for (const value of ['Backspace', 'Delete', 'ArrowLeft']) {
      expect(key(input, value).defaultPrevented).toBe(false)
    }
    expectNoEditorActions(ports)
  })

  it('uses deep active input when an event is delivered at the shadow host', () => {
    const ports = createPorts()
    renderHook(() => useEditorKeyboardRouter(ports))
    const host = document.createElement('div')
    const innerHost = document.createElement('div')
    const input = document.createElement('textarea')
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).append(innerHost)
    innerHost.attachShadow({ mode: 'open' }).append(input)
    input.focus()
    key(host, 'Backspace')
    expectNoEditorActions(ports)
  })

  it('leaves all editor shortcuts untouched during preview or try-run and restores editing afterward', () => {
    const ports = createPorts()
    const mounted = renderHook(({ readOnly }) => useEditorKeyboardRouter({
      ...ports, isReadOnly: () => readOnly,
    }), { initialProps: { readOnly: true } })
    const playerListener = vi.fn()
    window.addEventListener('keydown', playerListener)
    try {
      for (const value of ['s', 'z', 'y', 'n', 'o', 'a', 'c', 'v', 'd']) {
        expect(key(document.body, value, { ctrlKey: true }).defaultPrevented).toBe(false)
      }
      for (const value of ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape']) {
        expect(key(document.body, value).defaultPrevented).toBe(false)
      }
      expectNoEditorActions(ports)
      expect(playerListener).toHaveBeenCalledTimes(16)
      mounted.rerender({ readOnly: false })
      expect(key(document.body, 'a', { ctrlKey: true }).defaultPrevented).toBe(true)
      expect(key(document.body, 'Backspace').defaultPrevented).toBe(true)
      expect(ports.selectAll).toHaveBeenCalledOnce()
      expect(ports.deleteSelectedNodes).toHaveBeenCalledOnce()
    } finally {
      window.removeEventListener('keydown', playerListener)
    }
  })

  it('respects already handled events and IME input', () => {
    const ports = createPorts()
    renderHook(() => useEditorKeyboardRouter(ports))
    const target = document.createElement('div')
    document.body.append(target)
    target.addEventListener('keydown', event => event.preventDefault())
    key(target, 'Backspace')
    key(document.body, 'Backspace', { isComposing: true })
    expectNoEditorActions(ports)
  })

  it('does not nudge authoring selection through a shadow button arrow key', () => {
    const ports = createPorts()
    renderHook(() => useEditorKeyboardRouter(ports))
    const host = document.createElement('div')
    document.body.append(host)
    const button = document.createElement('button')
    host.attachShadow({ mode: 'open' }).append(button)
    expect(key(button, 'ArrowRight').defaultPrevented).toBe(false)
    expectNoEditorActions(ports)
  })
})
