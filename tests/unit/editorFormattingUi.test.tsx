import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
import { detectFontAvailability } from '../../src/renderer/ui/properties/PropertyControls'
import { buildInitialRichTextHtml, TextEditOverlay } from '../../src/renderer/ui/TextEditOverlay'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
// Retained professional layout/IME helpers; formal edits are covered through the V10 writer suites.
describe('rich text editing geometry and selection', () => {
  it('serializes explicit false rich-style overrides instead of inheriting the base style', () => {
    const base = createTextNode()
    const node = {
      ...base,
      text: 'AB',
      style: {
        ...base.style,
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        emphasis: true,
        highlightColor: '#fff3a3',
      },
      runs: [{
        start: 0,
        end: 1,
        style: {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
        },
      }],
    }

    const html = buildInitialRichTextHtml(node)
    expect(html).toContain('font-weight:400')
    expect(html).toContain('font-style:normal')
    expect(html).toContain('text-decoration-line:none')
    expect(html).toContain('text-emphasis-style:none')
    expect(html).toContain('background-color:transparent')
  })

  it('keeps the exact rich-text selection while the emphasis toolbar button is pressed', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const workspace = document.createElement('div')
    const canvas = document.createElement('canvas')
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      width: 1280, height: 720, toJSON: () => ({}),
    })
    canvas.getBoundingClientRect = workspace.getBoundingClientRect
    const onPreview = vi.fn()
    const onCommit = vi.fn()
    render(
      <TextEditOverlay
        node={createTextNode({ text: '春风唤醒江南的大地', style: { overflow: 'fixed' } })}
        workspace={workspace}
        canvas={canvas}
        onPreview={onPreview}
        onCommit={onCommit}
        onCancel={() => undefined}
      />,
    )
    const editor = screen.getByTestId('text-edit-overlay')
    await waitFor(() => expect(document.activeElement).toBe(editor))
    const characterNodes = Array.from(editor.childNodes).slice(0, 4)
    if (characterNodes.length < 4) throw new Error('Expected four character nodes')
    const range = document.createRange()
    range.setStartBefore(characterNodes[0]!)
    range.setEndAfter(characterNodes[3]!)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(selection?.toString()).toBe('春风唤醒')

    const emphasisButton = screen.getByRole('button', { name: '局部着重号' })
    fireEvent.pointerDown(emphasisButton)
    const churnedRange = document.createRange()
    churnedRange.selectNodeContents(editor)
    selection?.removeAllRanges()
    selection?.addRange(churnedRange)
    fireEvent.mouseDown(emphasisButton)
    fireEvent.click(emphasisButton)

    expect(onPreview).toHaveBeenLastCalledWith('春风唤醒江南的大地', [
      { start: 0, end: 4, style: { emphasis: true } },
    ])
    expect(selection?.toString()).toBe('春风唤醒')

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledWith('春风唤醒江南的大地', [
      { start: 0, end: 4, style: { emphasis: true } },
    ])
  })

  it('does not rewrite an in-progress contentEditable value when the node resizes', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const workspace = document.createElement('div')
    const canvas = document.createElement('canvas')
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1400, bottom: 800,
      width: 1400, height: 800, toJSON: () => ({}),
    })
    canvas.getBoundingClientRect = () => ({
      x: 60, y: 40, left: 60, top: 40, right: 1340, bottom: 760,
      width: 1280, height: 720, toJSON: () => ({}),
    })
    const node = createTextNode()
    const onPreview = vi.fn()
    const result = render(
      <TextEditOverlay
        node={node}
        workspace={workspace}
        canvas={canvas}
        onPreview={onPreview}
        onCommit={() => undefined}
        onCancel={() => undefined}
      />,
    )
    const editor = screen.getByTestId('text-edit-overlay')
    editor.textContent = 'resize 期间正在输入'
    fireEvent.input(editor)

    result.rerender(
      <TextEditOverlay
        node={{ ...node, width: node.width + 180, height: node.height + 40 }}
        workspace={workspace}
        canvas={canvas}
        onPreview={onPreview}
        onCommit={() => undefined}
        onCancel={() => undefined}
      />,
    )

    expect(editor).toHaveTextContent('resize 期间正在输入')
    expect(onPreview).toHaveBeenLastCalledWith('resize 期间正在输入', [])
  })

  it('缩放或平移只改变视觉矩形时仍跟随 Player 画布', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const workspace = document.createElement('div')
    const canvas = document.createElement('canvas')
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1400, bottom: 800,
      width: 1400, height: 800, toJSON: () => ({}),
    })
    let canvasBounds = {
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      width: 1280, height: 720, toJSON: () => ({}),
    }
    canvas.getBoundingClientRect = () => canvasBounds
    const node = createTextNode({ x: 100, y: 80, width: 240, height: 100 })
    render(
      <TextEditOverlay
        node={node}
        workspace={workspace}
        canvas={canvas}
        onPreview={() => undefined}
        onCommit={() => undefined}
        onCancel={() => undefined}
      />,
    )
    const editor = screen.getByTestId('text-edit-overlay')
    expect(editor).toHaveStyle({ left: '100px', top: '80px', width: '240px' })

    canvasBounds = {
      x: 50, y: 30, left: 50, top: 30, right: 690, bottom: 390,
      width: 640, height: 360, toJSON: () => ({}),
    }
    await waitFor(() => expect(editor).toHaveStyle({
      left: '100px',
      top: '70px',
      width: '120px',
    }))
  })

  it('waits for IME composition to finish before committing a blur', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const workspace = document.createElement('div')
    const canvas = document.createElement('canvas')
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      width: 1280, height: 720, toJSON: () => ({}),
    })
    canvas.getBoundingClientRect = workspace.getBoundingClientRect
    const onCommit = vi.fn()
    render(
      <TextEditOverlay
        node={createTextNode()}
        workspace={workspace}
        canvas={canvas}
        onPreview={() => undefined}
        onCommit={onCommit}
        onCancel={() => undefined}
      />,
    )
    const editor = screen.getByTestId('text-edit-overlay')

    fireEvent.compositionStart(editor, { data: '中' })
    editor.textContent = '中文输入'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.blur(editor)
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.compositionEnd(editor, { data: '中文输入' })
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    expect(onCommit).toHaveBeenCalledWith('中文输入', [])
  })

  it('does not commit when focus lands on the canvas stage', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    const workspace = document.createElement('div')
    const canvas = document.createElement('div')
    canvas.className = 'canvas-stage'
    workspace.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720,
      width: 1280, height: 720, toJSON: () => ({}),
    })
    canvas.getBoundingClientRect = workspace.getBoundingClientRect
    const onCommit = vi.fn()
    render(
      <TextEditOverlay
        node={createTextNode()}
        workspace={workspace}
        canvas={canvas}
        onPreview={() => undefined}
        onCommit={onCommit}
        onCancel={() => undefined}
      />,
    )
    const editor = screen.getByTestId('text-edit-overlay')
    await waitFor(() => expect(document.activeElement).toBe(editor))

    const stack = document.createElement('div')
    stack.className = 'canvas-stage-stack'
    stack.tabIndex = 0
    document.body.append(stack)
    stack.focus()
    fireEvent.blur(editor, { relatedTarget: stack })
    await waitFor(() => expect(document.activeElement).toBe(editor))
    expect(onCommit).not.toHaveBeenCalled()
    stack.remove()
  })
})


describe('font family availability', () => {
  it('reports system-font availability through document.fonts', () => {
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        check: vi.fn((font: string) => font.includes('KaiTi')),
      },
    })
    try {
      expect(detectFontAvailability('KaiTi')).toBe('available')
      expect(detectFontAvailability('Arial')).toBe('unavailable')
      expect(detectFontAvailability('sans-serif')).toBe('available')
    } finally {
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts)
      } else {
        Reflect.deleteProperty(document, 'fonts')
      }
    }
  })

})
