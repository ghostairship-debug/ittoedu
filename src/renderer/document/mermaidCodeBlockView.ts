import type { EditorView, NodeView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

import { createMermaidPreview } from '../../shared/document/mermaidPreview'

/**
 * ProseMirror NodeView for `code_block`. When the block's language marks it as
 * mermaid, this view renders a live SVG preview above the editable source, so
 * a `.md` document's mermaid code fence no longer appears as plain text. For
 * other languages the view matches the schema's default `pre > code` output,
 * so the NodeView is safe to register for every code block.
 *
 * The `contentDOM` is the inner `<code>` so ProseMirror content editing and
 * the surrounding schema serialization (which expects `pre > code`) stay
 * unchanged. Async mermaid rendering is cancelled on destroy and skipped when
 * the source code hasn't changed between updates.
 */
export class MermaidCodeBlockView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private preview: HTMLElement | null = null
  private diagram: ReturnType<typeof createMermaidPreview> | null = null
  private lastSource = ''
  private mermaid = false
  private disposed = false
  constructor(node: PMNode, private view: EditorView) {
    this.dom = document.createElement('pre')
    this.dom.dataset.documentId = node.attrs.id as string
    this.applyLanguage(node, true)
    const code = document.createElement('code')
    this.dom.append(code)
    this.contentDOM = code
    if (this.mermaid) this.render(node.textContent)
  }
  update(node: PMNode): boolean {
    if (node.type.name !== 'code_block') return false
    this.applyLanguage(node, false)
    if (this.mermaid) this.render(node.textContent)
    return true
  }
  destroy() {
    this.disposed = true
    this.diagram?.destroy()
  }
  ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }): boolean {
    if ('type' in mutation && mutation.type === 'selection') return false
    if (!this.preview) return false
    return mutation.target === this.preview || this.preview.contains(mutation.target as globalThis.Node)
  }
  private applyLanguage(node: PMNode, initial: boolean) {
    const language = (node.attrs.data?.language as string | undefined) ?? ''
    const now = language === 'mermaid'
    if (initial) {
      this.mermaid = now
      if (now) {
        this.dom.dataset.codeLanguage = 'mermaid'
        this.preview = document.createElement('div')
        this.preview.className = 'mermaid-preview'
        this.preview.contentEditable = 'false'
        this.preview.setAttribute('aria-label', 'Mermaid 图示预览')
        this.preview.style.cssText = 'display:block;user-select:none;'
        this.dom.append(this.preview)
        this.diagram = createMermaidPreview(this.preview)
      }
      return
    }
    if (now === this.mermaid) return
    this.mermaid = now
    if (now) {
      this.dom.dataset.codeLanguage = 'mermaid'
      this.preview = document.createElement('div')
      this.preview.className = 'mermaid-preview'
      this.preview.contentEditable = 'false'
      this.preview.setAttribute('aria-label', 'Mermaid 图示预览')
      this.preview.style.cssText = 'display:block;user-select:none;'
      this.dom.insertBefore(this.preview, this.dom.firstChild)
      this.diagram = createMermaidPreview(this.preview)
      this.lastSource = ''
    } else {
      delete this.dom.dataset.codeLanguage
      this.diagram?.destroy(); this.diagram = null
      this.preview?.remove()
      this.preview = null
      this.lastSource = ''
    }
  }
  private render(source: string) {
    if (this.disposed || !this.preview || source === this.lastSource) return
    this.lastSource = source
    void this.diagram?.render(source)
  }
}
