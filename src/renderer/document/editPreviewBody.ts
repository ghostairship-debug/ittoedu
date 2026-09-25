import { DOMSerializer } from 'prosemirror-model'
import { parseDocumentMarkdown } from '../../shared/document/markdown'
import { toEditorDocument } from './documentAdapter'
import { documentEditorSchema } from './editorSchema'

export type PreviewFormat = 'markdown-blocks' | 'markdown-inline' | 'text' | 'source'
const base = DOMSerializer.fromSchema(documentEditorSchema)
const serializer = new DOMSerializer({ ...base.nodes, compound: node => node.attrs.data.type === 'list'
  ? [node.attrs.data.ordered ? 'ol' : 'ul', 0] : node.attrs.data.type === 'quote' ? ['blockquote', 0] : base.nodes.compound(node) }, base.marks)
/** Parse only the replacement fragment. Invalid/unfinished carriers remain literal, never become executable markup. */
export function previewBody(value: string, format: PreviewFormat): { dom: DocumentFragment; text: string; structured: boolean } {
  const dom = document.createDocumentFragment()
  const raw = () => { dom.append(document.createTextNode(value || '正在生成…')); return { dom, text: value, structured: false } }
  if (format === 'source' || format === 'text' || !value) return raw()
  let sequence = 0
  const parsed = parseDocumentMarkdown(value, { target: 'file', createId: kind => `preview-${kind}-${++sequence}` })
  if (parsed.status !== 'valid') return raw()
  // Images, components and other carriers require admitted resources, which an incomplete edit does not own.
  if (parsed.document.content.blocks.some(block => ['media', 'component', 'chart', 'section', 'callout'].includes(block.type))) return raw()
  const projected = toEditorDocument(parsed.document.content)
  if (format === 'markdown-inline' && (projected.childCount !== 1 || projected.firstChild?.type.name !== 'paragraph')) return raw()
  const content = format === 'markdown-inline' ? projected.firstChild!.content : projected.content
  dom.append(serializer.serializeFragment(content))
  // Temporary nodes are not canonical document identities or live navigation targets.
  dom.querySelectorAll('[data-document-id], [data-flow-block-id], [data-document-slot]').forEach(element => { element.removeAttribute('data-document-id'); element.removeAttribute('data-flow-block-id'); element.removeAttribute('data-document-slot') })
  dom.querySelectorAll('a').forEach(element => { element.removeAttribute('href'); element.removeAttribute('target'); element.setAttribute('aria-disabled', 'true') })
  return { dom, text: projected.textBetween(0, projected.content.size, '\n'), structured: true }
}
export interface PreviewBodyWidget { element: HTMLElement; update(value: string, cancel: () => void): void; destroy(): void }
export function createPreviewBodyWidget(editId: string, value: string, format: PreviewFormat, cancel: () => void): PreviewBodyWidget {
  const element: HTMLElement = document.createElement(format === 'markdown-blocks' ? 'div' : 'span')
  element.className = `document-generation-preview document-generation-preview--${format}`
  element.setAttribute('contenteditable', 'false'); element.tabIndex = 0
  element.dataset.editPreview = editId; element.setAttribute('aria-label', '正在生成的正文，尚未提交')
  element.title = '正在生成，尚未提交。按 Esc 停止生成后继续编辑。'
  let latest = value, rendered = value, stop = cancel, frame: number | undefined, disposed = false
  const paint = () => {
    frame = undefined; if (disposed) return
    const body = previewBody(latest, format); rendered = latest
    element.replaceChildren(body.dom); element.dataset.previewStructure = body.structured ? 'parsed' : 'literal'
  }
  paint()
  element.addEventListener('keydown', event => { if (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); stop() } })
  element.addEventListener('copy', event => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && element.contains(selection.anchorNode) && element.contains(selection.focusNode) && event.clipboardData) {
      event.preventDefault(); event.stopPropagation(); event.clipboardData.setData('text/plain', selection.toString())
    }
  })
  element.addEventListener('cut', event => { event.preventDefault(); event.stopPropagation() })
  return { element, update(next, onCancel) {
    latest = next; stop = onCancel
    if (next !== rendered && frame === undefined) frame = requestAnimationFrame(paint)
  }, destroy() { disposed = true; if (frame !== undefined) cancelAnimationFrame(frame) } }
}
