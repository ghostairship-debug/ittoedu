import { useState, useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { HtmlLightEditOverlay } from '../../src/renderer/documentFiles/html/HtmlLightEditOverlay'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import type { HtmlSelectedTarget } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

function selected(source: string, text: string, handle = 'text'): HtmlSelectedTarget {
  const start = source.indexOf(text)
  return { report: { handle, kind: 'text', rawText: text, domPath: [], sectionOrder: null,
    attributeName: null, rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false },
  resolved: { handle, status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 1,
    bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: source.length },
    valueSpan: { start, end: start + text.length }, attributeName: null, expectedRaw: text } } }
}

const source = '<p>原文字</p>'
const target = selected(source, '原文字')
const committed: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 1,
  model: { kind: 'text', source, resources: { assets: {}, components: {} } },
  binding: { kind: 'file', path: '/lesson.html', version: 'v1', bindingVersion: 1 },
  dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }

it('keeps author clicks working in preview and suppresses both clicks before editing a button label', () => {
  document.body.innerHTML = '<button id="preview">页面动作</button><button id="edit">编辑标题</button><input type="checkbox">'
  const preview = document.querySelector<HTMLButtonElement>('#preview')!
  const edit = document.querySelector<HTMLButtonElement>('#edit')!
  const previewAction = vi.fn()
  const editAction = vi.fn(() => { edit.textContent = '页面操作已触发' })
  const delegatedAction = vi.fn()
  preview.onclick = previewAction
  edit.onclick = editAction
  // Author document capture listeners can be installed before the preview agent mounts.
  document.addEventListener('click', delegatedAction, true)
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true,
    value: () => ({ offsetNode: edit.firstChild, offset: 0 }) })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true,
    value: () => ({ x: 5, y: 5, width: 80, height: 20 }) })
  const posted = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  const dispose = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    fireEvent.click(preview)
    expect(previewAction).toHaveBeenCalledOnce()
    expect(delegatedAction).toHaveBeenCalledOnce()
    command({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'edit-on', enabled: true })
    fireEvent.click(edit)
    fireEvent.click(edit)
    fireEvent.doubleClick(edit)
    expect(editAction).not.toHaveBeenCalled()
    expect(delegatedAction).toHaveBeenCalledOnce()
    expect(edit.textContent).toBe('编辑标题')
    expect(posted.mock.calls.map(call => call[0]).filter(value => value.event === 'targets'))
      .toEqual([expect.objectContaining({ targets: [expect.objectContaining({ rawText: '编辑标题', scriptCreated: false })] })])
    // The caret lookup can return nearby text when the actual click was on a control.
    const checkbox = document.querySelector('input')!
    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)
    command({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'edit-off', enabled: false })
    fireEvent.click(edit)
    expect(editAction).toHaveBeenCalledOnce()
    expect(delegatedAction).toHaveBeenCalledTimes(3)
    expect(edit.textContent).toBe('页面操作已触发')
  } finally {
    dispose()
    document.removeEventListener('click', delegatedAction, true)
    Reflect.deleteProperty(document, 'caretPositionFromPoint')
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  }
})

it('focuses the text editor, preserves its owner draft on Escape and returns focus without interrupting IME', () => {
  const drafts = new HtmlTextDrafts()
  const previous = document.createElement('button')
  previous.textContent = '返回预览'
  document.body.append(previous)
  previous.focus()
  function Owner() {
    const retained = useSyncExternalStore(drafts.subscribe, drafts.read)
    const [open, setOpen] = useState(true)
    return open ? <HtmlLightEditOverlay target={target} committed={committed} position={{ left: 8, top: 8 }}
      value={retained[0]?.value ?? target.report.rawText} onValue={value => drafts.change(target, source, value)}
      onText={vi.fn()} onImage={vi.fn()} onClose={() => setOpen(false)} /> : null
  }
  render(<Owner />)
  const input = screen.getByRole('textbox', { name: 'HTML 文字' })
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: '尚未应用的修改' } })
  fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(drafts.read()[0]?.value).toBe('尚未应用的修改')
  expect(previous).toHaveFocus()
  expect(drafts.prepare(source)).toEqual({ ready: true, source: '<p>尚未应用的修改</p>' })
})

it('leaves focus on a newly chosen view control when its editing overlay unmounts', () => {
  const props = { target, committed, position: { left: 8, top: 8 }, value: '原文字',
    onValue: vi.fn(), onText: vi.fn(), onImage: vi.fn(), onClose: vi.fn() }
  const previous = document.createElement('button')
  const nextView = document.createElement('button')
  document.body.append(previous, nextView)
  previous.focus()
  const mounted = render(<HtmlLightEditOverlay {...props} />)
  expect(screen.getByRole('textbox', { name: 'HTML 文字' })).toHaveFocus()
  nextView.focus()
  mounted.unmount()
  expect(nextView).toHaveFocus()
})

it('allows saving after the stated copy, reselect, apply and discard-old-draft conflict recovery', () => {
  const drafts = new HtmlTextDrafts()
  drafts.change(target, source, '我的修改')
  const changed = '<p>新原文</p>'
  drafts.reconcile(changed)
  const conflict = drafts.read()[0]!
  expect(conflict.issue).toContain('复制草稿，重新选择文字并粘贴、应用')
  expect(conflict.issue).toContain('“放弃这份草稿”移除旧草稿后保存')
  const replacement = selected(changed, '新原文', 'reselected')
  drafts.change(replacement, changed, conflict.value)
  const applied = '<p>我的修改</p>'
  drafts.reconcile(applied)
  drafts.applied(replacement, changed, conflict.value)
  expect(drafts.prepare(applied).ready).toBe(false)
  drafts.discard(conflict.id)
  expect(drafts.prepare(applied)).toEqual({ ready: true, source: applied })
  expect(drafts.read()).toEqual([])
})
