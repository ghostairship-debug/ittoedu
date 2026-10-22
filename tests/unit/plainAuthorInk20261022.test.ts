import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

it('suppresses only the exact text range without changing author DOM, geometry or its sibling run', () => {
  const registry = new Map<string, { ranges: Range[] }>(), adopted = Object.getOwnPropertyDescriptor(document, 'adoptedStyleSheets')
  class Paint { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges } }
  class Sheet { replaceSync = vi.fn() }
  vi.stubGlobal('CSS', { highlights: registry }); vi.stubGlobal('Highlight', Paint); vi.stubGlobal('CSSStyleSheet', Sheet)
  Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
  const paragraph = document.createElement('p'), first = document.createTextNode(' ME'), sibling = document.createElement('strong')
  sibling.textContent = ' kept'; paragraph.append(first, sibling); document.body.append(paragraph)
  const owner = createDomAuthoring(document.body, { records: () => ({}) })
  try {
    owner.suppressText(first)
    expect(registry.size).toBe(1)
    const range = [...registry.values()][0]!.ranges[0]!
    expect(range.startContainer).toBe(first); expect(range.endContainer).toBe(first)
    expect(range.toString()).toBe(' ME'); expect(paragraph.childNodes).toHaveLength(2)
    expect(paragraph.firstChild).toBe(first); expect(sibling.textContent).toBe(' kept')
    expect(first.textContent).toBe(' ME'); expect(document.querySelector('[data-cw-author-input-paint]')).toBeNull()
    expect(document.adoptedStyleSheets).toHaveLength(1)
    first.data = ' ME QA'; owner.refresh()
    const updatedRange = [...registry.values()][0]!.ranges[0]!
    expect(updatedRange.startContainer).toBe(first); expect(updatedRange.endContainer).toBe(first)
    expect(updatedRange.toString()).toBe(' ME QA'); expect(updatedRange.endOffset).toBe(first.length)
    owner.suppressText(); expect(registry.size).toBe(0)
    owner.refresh(); expect(registry.size).toBe(0)
    owner.suppressText(first); owner.dispose()
    expect(registry.size).toBe(0); expect(document.adoptedStyleSheets).toHaveLength(0)
  } finally { owner.dispose(); if (adopted) Object.defineProperty(document, 'adoptedStyleSheets', adopted); else Reflect.deleteProperty(document, 'adoptedStyleSheets') }
})
