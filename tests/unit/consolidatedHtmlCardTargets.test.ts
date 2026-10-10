import { expect, it, vi } from 'vitest'
import { HtmlPreviewController } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import type { HtmlPreviewLease } from '../../src/shared/workbench/htmlPreview'

it('tracks original HTML author target geometry after deselection, rejects stale reports and selects only on explicit click', () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  Object.defineProperty(iframe, 'clientWidth', { value: 400 }); Object.defineProperty(iframe, 'clientHeight', { value: 200 })
  iframe.getBoundingClientRect = () => new DOMRect(100, 50, 800, 400)
  const lease = { leaseId: 'lease', loadId: 'load', documentId: 'html', epoch: 'epoch', revision: 0, bindingVersion: 1, url: 'http://127.0.0.1/fixture' } satisfies HtmlPreviewLease
  const controller = new HtmlPreviewController(iframe, lease, { onTarget: vi.fn(), onReady: vi.fn(), onEditModeReady: vi.fn(), onPage: vi.fn(), onEditing: vi.fn(), onApplied: vi.fn(), onEditSettled: vi.fn(), onPatchMismatch: vi.fn() })
  const target = { handle: 'title', kind: 'text', domPath: [], sectionOrder: null, rawText: 'Hello', attributeName: null,
    rect: { x: 20, y: 40, width: 100, height: 20 }, scriptCreated: false,
    authoring: { authorKey: 'title-key', record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], textIndex: 0, baseline: 'Hello' }, overrides: {} } } }
  const report = (seq: number, targets = [target], loadId = 'load') => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
    data: { event: 'card-targets', protocol: 1, leaseId: 'lease', loadId, seq, targets } }))
  try {
    controller.setEditMode(true); expect(controller.cardRect('title-key')).toBeNull()
    expect(post).toHaveBeenCalledWith({ type: 'html-preview.card-targets', loadId: 'load', authorKeys: ['title-key'] }, '*')
    report(2)
    expect(controller.cardRect('title-key')).toMatchObject({ x: 140, y: 130, width: 200, height: 40 })
    expect(post.mock.calls.filter(call => call[0].type === 'html-preview.select-author')).toHaveLength(0)
    controller.clearSelection(); expect(controller.cardRect('title-key')).not.toBeNull()
    report(1, []); report(3, [], 'previous-load'); expect(controller.cardRect('title-key')).not.toBeNull()
    expect(controller.selectAuthor('title-key')).toBe(true)
    expect(post).toHaveBeenCalledWith({ type: 'html-preview.select-author', loadId: 'load', authorKey: 'title-key' }, '*')
    report(4, []); expect(controller.cardRect('title-key')).toBeNull(); expect(controller.selectAuthor('title-key')).toBe(false)
  } finally { controller.dispose(); post.mockRestore(); iframe.remove() }
})
