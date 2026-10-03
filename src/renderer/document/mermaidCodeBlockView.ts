import type { EditorView, NodeView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

type MermaidApi = import('mermaid').Mermaid
let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(api => {
      const mermaid = api.default
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
      return mermaid
    })
  }
  return mermaidPromise
}

function isMermaidSource(source: string): boolean {
  const head = source.trimStart().slice(0, 40)
  return /^(flowchart\b|graph\b|sequenceDiagram\b|classDiagram\b|stateDiagram(?:-v2)?\b|erDiagram\b|journey\b|gantt\b|pie\b|gitGraph\b|mindmap\b|timeline\b|quadrantChart\b|requirementDiagram\b|C4) /.test(head + ' ')
    || /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram)\s*$/.test(head.trim())
}

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
  private renderToken = 0
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
    this.renderToken++
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
      this.lastSource = ''
    } else {
      delete this.dom.dataset.codeLanguage
      this.preview?.remove()
      this.preview = null
      this.lastSource = ''
    }
  }
  private render(source: string) {
    if (this.disposed || !this.preview || source === this.lastSource) return
    this.lastSource = source
    const token = ++this.renderToken
    const preview = this.preview
    if (!source.trim() || !isMermaidSource(source)) {
      preview.replaceChildren()
      preview.dataset.state = 'empty'
      return
    }
    preview.dataset.state = 'loading'
    void loadMermaid().then(async mermaid => {
      if (this.disposed || token !== this.renderToken || !this.preview) return
      const id = `mermaid-${Math.random().toString(36).slice(2)}`
      try {
        const { svg } = await mermaid.render(id, source)
        if (this.disposed || token !== this.renderToken || !this.preview) return
        this.preview.dataset.state = 'ready'
        this.preview.replaceChildren()
        const frame = document.createElement('div')
        frame.className = 'mermaid-preview__svg'
        frame.innerHTML = svg
        this.preview.append(frame)
      } catch (error) {
        if (this.disposed || token !== this.renderToken || !this.preview) return
        this.preview.dataset.state = 'error'
        const message = error instanceof Error ? error.message : String(error)
        const box = document.createElement('div')
        box.className = 'mermaid-preview__error'
        box.textContent = `Mermaid 暂无法渲染：${message}`
        this.preview.replaceChildren(box)
        // mermaid.render() appends its failed scratch element to document.body; remove it.
        document.getElementById(`d${id}`)?.remove()
        document.getElementById(id)?.remove()
      }
    }).catch(() => {
      if (this.disposed || token !== this.renderToken || !this.preview) return
      this.preview.dataset.state = 'error'
    })
  }
}
