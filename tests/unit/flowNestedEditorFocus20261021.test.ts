import { expect, it, vi } from 'vitest'
import { createLayoutEditor, DOCUMENT_OBJECT_CONTEXT_MENU_EVENT } from '../../src/renderer/document/editorSession'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { DocumentContent } from '../../src/shared/document/content'

it.each(['nested editor', 'relocated group editor', 'native input'])('keeps %s focus and events inside a Flow component object', (kind) => {
  const element = document.createElement('div')
  document.body.append(element)
  const requests = vi.fn()
  element.addEventListener(DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, requests)
  let target!: HTMLElement
  const content = { blocks: [
    { id: 'intro', type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } },
    { id: 'object', type: 'course-instance', instanceId: 'component' },
  ] } as unknown as DocumentContent
  const editor = createLayoutEditor(element, {
    document: { content, resources: emptyDocumentResources() }, revision: 'r1', presentation: 'flow',
    change: vi.fn(), diagnostic: vi.fn(), undo: vi.fn(), redo: vi.fn(),
    renderObject: (_block, host) => {
      if (kind !== 'native input') {
        const overlay = document.createElement('div')
        overlay.dataset.componentProfessionalEditor = ''
        target = document.createElement('div')
        target.contentEditable = 'true'
        target.setAttribute('contenteditable', 'true')
        target.innerHTML = '<span>可持续编辑的原生文字</span>'
        overlay.append(target); host.append(overlay)
      } else {
        target = document.createElement('input')
        host.append(target)
      }
    },
  })
  try {
    if (kind === 'relocated group editor') {
      const figure = element.querySelector('figure')!
      figure.append(target.parentElement!) // Flow projects group children beside the reusable object host.
    }
    target.focus()
    const before = editor.view.state.selection.toJSON()
    const eventTarget = target.firstElementChild ?? target
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    if (kind === 'relocated group editor') {
      const figure = element.querySelector('figure') as HTMLElement & { pmViewDesc: { stopEvent(event: Event): boolean } }
      expect(figure.pmViewDesc.stopEvent(down)).toBe(false) // An unattached event has no target.
      eventTarget.dispatchEvent(down)
      expect(figure.pmViewDesc.stopEvent(down)).toBe(true)
    } else eventTarget.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(target)
    expect(editor.view.state.selection.toJSON()).toEqual(before)
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    eventTarget.dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false)
    expect(requests).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(target)
  } finally { editor.destroy(); element.remove() }
})
