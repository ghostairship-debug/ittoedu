import { act, cleanup, renderHook } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorKeyboardRouter, type EditorKeyboardActionPorts } from '../../src/renderer/app/useEditorKeyboardRouter'
import { useCourseCanvasPaste, type CourseCanvasPastePorts } from '../../src/renderer/app/useCourseCanvasPaste'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function appReadOnly(hook: string, activeWorkspaceKind: { current: string }): () => boolean {
  const source = readFileSync(resolve('src/renderer/App.tsx'), 'utf8')
  const start = source.indexOf(`${hook}({`)
  const expression = source.slice(start).match(/isReadOnly: \(\) => (.*),\r?\n/)?.[1]
  if (start < 0 || !expression) throw new Error(`Missing App ownership port: ${hook}`)
  // Exercise the production entry predicates, so removing the App wiring
  // cannot leave a green test that only injects its own ownership rule.
  return new Function('activeWorkspaceKind', 'courseDelivery', 'useEditorStore', `return () => ${expression}`)(
    activeWorkspaceKind, { previewOpen: false }, { getState: () => ({ canvasMode: 'edit' }) })
}

it('leaves the background course and its selection untouched while a media tab owns keyboard and clipboard', async () => {
  const h = await createV10StoreHost(createBlankCourseProjectV10('background'))
  const activeKind = { current: 'course' }
  const keyboard: EditorKeyboardActionPorts = {
    isReadOnly: appReadOnly('useEditorKeyboardRouter', activeKind),
    captureDeleteSnapshot: vi.fn(() => ({ hasCourseProject: true, selection: null, contentEditable: false,
      hasFlowSession: false, flowComposing: false, flowTextFocus: false, flowHasSelection: false,
      hasSlideBackend: true, slideTextEdit: false, slideFormulaEdit: false, selectedNodeCount: 1, editingText: false })),
    routeEditorAction: vi.fn(() => ({ ok: true, reason: '已受理' })),
    deleteSelectedNodes: vi.fn(), copySelection: vi.fn(), cutSelection: vi.fn(), pasteClipboard: vi.fn(),
    duplicateSelection: vi.fn(), nudgeSelection: vi.fn(), undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn(),
    clearSelection: vi.fn(), selectedCount: vi.fn(() => 1), saveProject: vi.fn(), newProject: vi.fn(), openProject: vi.fn(),
  }
  const clipboard: CourseCanvasPastePorts = { kernel: h.kernel, isReadOnly: appReadOnly('useCourseCanvasPaste', activeKind), ownsPaste: () => false,
    copyInternalClipboard: vi.fn(() => true), pasteInternalClipboard: vi.fn(() => true),
    reportError: vi.fn(), commitStatus: vi.fn() }
  renderHook(() => { useEditorKeyboardRouter(keyboard); useCourseCanvasPaste(clipboard) })
  const before = h.first.read(), selection = [...h.kernel.readView().selectedInstanceIds]
  activeKind.current = 'media'
  for (const [key, ctrlKey] of [['Delete', false], ['d', true], ['y', true], ['s', true]] as const) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
  }
  for (const type of ['copy', 'cut', 'paste']) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    act(() => document.body.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(false)
  }
  expect(keyboard.deleteSelectedNodes).not.toHaveBeenCalled()
  expect(keyboard.duplicateSelection).not.toHaveBeenCalled()
  expect(keyboard.redo).not.toHaveBeenCalled()
  expect(keyboard.saveProject).not.toHaveBeenCalled()
  expect(clipboard.copyInternalClipboard).not.toHaveBeenCalled()
  expect(clipboard.pasteInternalClipboard).not.toHaveBeenCalled()
  expect(h.first.read()).toEqual(before)
  expect(h.kernel.readView().selectedInstanceIds).toEqual(selection)
  activeKind.current = 'course'
  act(() => document.body.dispatchEvent(new Event('copy', { bubbles: true, cancelable: true })))
  expect(clipboard.copyInternalClipboard).toHaveBeenCalledOnce()
  h.bridge.dispose()
})
