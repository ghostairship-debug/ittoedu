import { buildFlowTextStyleCss } from '../../shared/flowRichText'
import { Schema, type DOMOutputSpec, type NodeSpec } from 'prosemirror-model'
import katex from 'katex'
import { tableNodes } from 'prosemirror-tables'
import { resolveFlowParagraphPresentation } from '../../shared/flowBodyPresentation'

const blockAttrs = { id: { default: null }, data: { default: {} } }
const textBlock = (tag: string): NodeSpec => ({
  attrs: blockAttrs, group: 'block', content: 'inline*',
  toDOM: node => { const style = resolveFlowParagraphPresentation(node.attrs.data); return [tag, { 'data-document-id': node.attrs.id, 'data-flow-block-id': node.attrs.id, style: `text-align:${style.textAlign};line-height:${style.lineHeight}` }, 0] as DOMOutputSpec },
})
export const documentEditorSchema = new Schema({
  nodes: {
    doc: { content: 'block*' }, text: { group: 'inline' },
    ...tableNodes({ tableGroup: 'table', cellContent: 'slot', cellAttributes: {} }),
    table_container: { group: 'block', content: 'slot? table', isolating: true, attrs: blockAttrs,
      toDOM: node => ['figure', { 'data-document-id': node.attrs.id }, 0] },
    paragraph: textBlock('p'),
    heading: { ...textBlock('h2'), toDOM: node => [`h${node.attrs.data.level ?? 2}`, { 'data-document-id': node.attrs.id }, 0] },
    slot: { content: 'inline*', attrs: { key: { default: 'title' } }, toDOM: node => [node.attrs.key.startsWith('item:') ? 'li' : node.attrs.key === 'citation' ? 'cite' : 'div', { 'data-document-slot': node.attrs.key }, 0] },
    // Compound carriers keep their own structure; only named body slots are editable.
    compound: { group: 'block', content: 'slot*', isolating: true, attrs: blockAttrs,
      toDOM: node => ['section', { class: `document-object document-${node.attrs.data.type}`, 'data-document-id': node.attrs.id }, 0] },
    section: { group: 'block', content: 'slot block*', defining: true, attrs: blockAttrs,
      toDOM: node => ['section', { 'data-document-id': node.attrs.id }, 0] },
    formula: { group: 'block', atom: true, attrs: blockAttrs,
      toDOM: node => mathDOM(node.attrs.data, true) },
    object: { group: 'block', atom: true, attrs: blockAttrs,
      toDOM: node => ['div', { class: 'document-object-card', 'data-document-id': node.attrs.id }, `${node.attrs.data.type} 对象`] },
    code_block: { group: 'block', content: 'text*', code: true, marks: '', attrs: blockAttrs,
      toDOM: () => ['pre', ['code', 0]] },
    math: { inline: true, group: 'inline', atom: true, attrs: { data: {} },
      toDOM: node => mathDOM(node.attrs.data, false) },
    hard_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'] },
  },
  marks: {
    style: { attrs: { value: {} }, toDOM: mark => {
      const css = buildFlowTextStyleCss(mark.attrs.value)
      return ['span', { style: css }, 0]
    } },
    code: { toDOM: () => ['code', 0] },
    link: { attrs: { href: {}, title: { default: null } }, inclusive: false,
      toDOM: mark => ['a', { href: /^(https?:|mailto:|#|\.\/)/i.test(mark.attrs.href) ? mark.attrs.href : undefined, title: mark.attrs.title }, 0] },
  },
})

function mathDOM(data: { latex: string; accessibleText: string; formulaId: string }, displayMode: boolean): HTMLElement {
  const element = document.createElement(displayMode ? 'div' : 'span')
  element.className = 'document-math'
  element.dataset.formulaId = data.formulaId
  element.setAttribute('aria-label', data.accessibleText)
  element.contentEditable = 'false'
  katex.render(data.latex, element, { displayMode, throwOnError: false, trust: false })
  return element
}
