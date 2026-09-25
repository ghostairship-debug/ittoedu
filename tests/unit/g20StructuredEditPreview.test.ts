import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { EditorState as SourceState } from '@codemirror/state'
import { EditorView as SourceView } from '@codemirror/view'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import * as markdown from '../../src/shared/document/markdown'
import { toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { layoutPreviewKey, layoutPreviewPlugin, layoutPreviewRange, layoutPreviewClipboard, sourcePreviewEffect, sourcePreviewExtensions, sourcePreviewRange, type DocumentEditPreview } from '../../src/renderer/document/editPreviewWidgets'
import { previewBody } from '../../src/renderer/document/editPreviewBody'

const views: EditorView[] = []
afterEach(() => { views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function fixture(source: string, preview: DocumentEditPreview) {
  let sequence = 0
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: kind => `${kind}-${++sequence}` })
  if (parsed.status !== 'valid') throw new Error('Invalid fixture')
  const blocked = vi.fn(), host = document.createElement('div'); document.body.append(host)
  const view = new EditorView(host, { state: EditorState.create({ doc: toEditorDocument(parsed.document.content), plugins: [layoutPreviewPlugin(blocked)] }) }); views.push(view)
  const range = layoutPreviewRange(view.state.doc, preview, parsed.sourceMap)!
  view.dispatch(view.state.tr.setMeta(layoutPreviewKey, range))
  return { view, range, blocked, parsed }
}
describe('structured volatile body projection', () => {
  it('keeps the original range visible but read-only before the first generated fragment in layout and source editors', () => {
    const source = '前文\n\n等待改写\n\n后文\n', start = source.indexOf('等待改写'), end = start + '等待改写'.length
    const preview = { editId: 'begin', sequence: -1, target: { kind: 'markdown-range' as const, from: start, to: end }, value: '', cancel() {} }
    const f = fixture(source, preview)
    const layout = layoutPreviewRange(f.view.state.doc, preview, f.parsed.sourceMap)!
    expect(layout).toMatchObject({ from: layout.from, to: layout.from, protectedTo: expect.any(Number) })
    expect(layout.protectedTo).toBeGreaterThan(layout.from)
    expect(f.view.dom.textContent).toContain('等待改写')
    const targetText = f.view.state.doc.textContent
    f.view.dispatch(f.view.state.tr.insertText('不应覆盖', layout.from + 1))
    expect(f.blocked).toHaveBeenCalledOnce()
    expect(f.view.state.doc.textContent).toBe(targetText)
    f.view.dispatch(f.view.state.tr.insertText('人工保留', f.view.state.doc.content.size - 1))
    expect(f.view.state.doc.textContent).toContain('后文人工保留')

    const blocked = vi.fn(), host = document.createElement('div'); document.body.append(host)
    const sourceView = new SourceView({ parent: host, state: SourceState.create({ doc: source, extensions: sourcePreviewExtensions(blocked) }) })
    try {
      const range = sourcePreviewRange(preview, f.parsed.sourceMap)!
      sourceView.dispatch({ effects: sourcePreviewEffect.of(range) })
      expect(sourceView.dom.textContent).toContain('等待改写')
      sourceView.dispatch({ changes: { from: start + 1, to: start + 2, insert: '错' } })
      expect(blocked).toHaveBeenCalledOnce()
      expect(sourceView.state.doc.toString()).toBe(source)
      sourceView.dispatch({ changes: { from: source.length, insert: '人工保留' } })
      expect(sourceView.state.doc.toString()).toBe(`${source}人工保留`)
    } finally { sourceView.destroy(); host.remove() }
  })
  it('renders complete Markdown blocks outside the original heading and copies visible body without changing canonical source', () => {
    const source = '# 原标题\n\n原正文😀\n', value = '# 课堂引入\n\n先复习，再提出问题😀\n\n- 观察\n- 解释'
    const f = fixture(source, { editId: 'whole', target: { kind: 'markdown-range', from: 0, to: source.length }, value, cancel() {} })
    const widget = f.view.dom.querySelector('[data-edit-preview]')!
    expect(widget.parentElement).toBe(f.view.dom)
    expect(widget.querySelector('h1')?.textContent).toBe('课堂引入')
    expect(widget.querySelector('p')?.textContent).toBe('先复习，再提出问题😀')
    expect(widget.querySelectorAll('ul > li')).toHaveLength(2)
    expect(widget.getAttribute('contenteditable')).toBe('false')
    expect([...f.view.dom.children].filter(node => node !== widget).every(node => node.classList.contains('document-generation-hidden'))).toBe(true)
    expect(f.view.state.doc.textContent).toBe('原标题原正文😀')
    expect(f.view.state.selection.empty).toBe(false) // No caret remains inside a hidden heading.
    f.view.dispatch(f.view.state.tr.insertText('不应写入', f.range.from))
    expect(f.blocked).toHaveBeenCalled(); expect(f.view.state.doc.textContent).toBe('原标题原正文😀')
    f.view.dispatch(f.view.state.tr.setSelection(TextSelection.create(f.view.state.doc, f.range.from, f.range.to)))
    const setData = vi.fn(), event = new Event('copy', { cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { setData } })
    expect(layoutPreviewClipboard(f.view, event, false)).toBe(true)
    expect(setData.mock.calls[0][1]).toContain('课堂引入\n先复习，再提出问题😀')
    expect(setData.mock.calls[0][1]).not.toContain('# ')
  })
  it('coalesces fragment parsing per frame, preserves incomplete unsafe text, and destroys queued paint on cancellation', () => {
    const frames = new Map<number, FrameRequestCallback>(); let frameId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
    const source = '# old\n', cancel = vi.fn(), f = fixture(source, { editId: 'stream', target: { kind: 'markdown-range', from: 0, to: source.length }, value: '# 一', cancel })
    const widget = f.view.dom.querySelector('[data-edit-preview]'), parser = vi.spyOn(markdown, 'parseDocumentMarkdown')
    for (const value of ['# 一二', '# 一二三', '# 最后\n\n正文']) f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, { ...f.range, value }))
    expect(f.view.dom.querySelector('[data-edit-preview]')).toBe(widget)
    expect(parser).not.toHaveBeenCalled(); expect(frames.size).toBe(1)
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(1)) }
    flush(); expect(parser).toHaveBeenCalledTimes(1); expect(parser.mock.calls[0][0]).toBe('# 最后\n\n正文')
    expect(widget?.querySelector('p')?.textContent).toBe('正文')
    const unfinished = '```cw-object-v1\n{"block":<script>alert(1)</script>'
    f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, { ...f.range, value: unfinished })); flush()
    expect(widget?.textContent).toBe(unfinished); expect(widget?.querySelector('script')).toBeNull()
    expect(previewBody('# 源文保持标记', 'source').dom.textContent).toBe('# 源文保持标记')
    widget?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(cancel).toHaveBeenCalledTimes(1)
    f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, { ...f.range, value: '迟到尚待画帧' }))
    f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, null)); flush()
    expect(f.view.dom.querySelector('[data-edit-preview]')).toBeNull(); expect(f.view.state.doc.textContent).toBe('old'); expect(f.view.state.selection).toBeInstanceOf(TextSelection)
  })
  it('keeps Flow literals and canonical mapping while another paragraph is edited, then withdraws only the volatile projection', () => {
    const source = '甲😀乙丙\n\n另一段\n'
    let next = 0; const parsed = parseDocumentMarkdown(source, { target: 'file', createId: () => `id-${++next}` }); if (parsed.status !== 'valid') throw new Error('Invalid fixture')
    const id = parsed.document.content.blocks[0].id
    const f = fixture(source, { editId: 'flow', target: { kind: 'flow-range', surfaceId: 'flow', blockId: id, parentId: null, slot: { kind: 'field', field: 'content' }, from: 1, to: 3 }, value: '# Flow 字面😀', cancel() {} })
    // Fixture allocators differ, so use the actual block identity without rebuilding the view.
    const target: DocumentEditPreview = { editId: 'flow', target: { kind: 'flow-range', surfaceId: 'flow', blockId: f.parsed.document.content.blocks[0].id, parentId: null, slot: { kind: 'field', field: 'content' }, from: 1, to: 3 }, value: '# Flow 字面😀', cancel() {} }
    const range = layoutPreviewRange(f.view.state.doc, target, f.parsed.sourceMap)!
    f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, range))
    expect(f.view.dom.querySelector('[data-edit-preview]')?.textContent).toBe('# Flow 字面😀')
    expect(f.view.dom.querySelector('[data-edit-preview] h1')).toBeNull()
    f.view.dispatch(f.view.state.tr.insertText('人工', f.view.state.doc.content.size - 1))
    expect(f.view.state.doc.textContent).toBe('甲😀乙丙另一段人工')
    expect(layoutPreviewKey.getState(f.view.state)?.from).toBe(range.from)
    f.view.dispatch(f.view.state.tr.insertText('不行', range.from + 1)); expect(f.view.state.doc.textContent).toBe('甲😀乙丙另一段人工')
    f.view.dispatch(f.view.state.tr.setMeta(layoutPreviewKey, null))
    expect(f.view.dom.querySelector('[data-edit-preview]')).toBeNull(); expect(f.view.state.doc.textContent).toBe('甲😀乙丙另一段人工')
  })
})
