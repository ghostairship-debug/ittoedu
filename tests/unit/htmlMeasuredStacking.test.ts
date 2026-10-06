// @vitest-environment node
import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { expect, it } from 'vitest'
import { assembleMeasuredHtml, type HtmlDesignCapture, type MeasuredHtmlElement } from '../../src/core/contentApply/assembly/htmlAssembly'
import { assemblyContentDraft } from '../../src/main/workbench/contentApply/application/html'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { WEB_DEFINITION } from '../../src/components/web/data'
import type { ContentObjectDraft } from '../../src/core/contentApply/planning/types'

/** Fixed measured boxes; CSS paint inputs are kept distinct from formal frame/order. */
function measured(html: string) {
  const document = parse(html), root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node)!
  const body = root.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'body')!
  const elements: MeasuredHtmlElement[] = []
  const append = (node: DefaultTreeAdapterTypes.Element, sourcePath: number[], parentDisplay = 'block'): number => {
    const index = elements.length
    const attributes = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]))
    const declarations = Object.fromEntries((attributes.style ?? '').split(';').filter(value => value.includes(':')).map(value => {
      const colon = value.indexOf(':'); return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()]
    }))
    const value: MeasuredHtmlElement = { sourcePath, tagName: node.tagName, sourceHtml: serializeOuter(node), attributes,
      style: { display: 'block', position: 'static', 'z-index': 'auto', 'font-family': 'sans-serif', 'font-size': '16px',
        color: '#ffffff', 'line-height': '24px', 'text-align': 'left', ...declarations }, parentDisplay,
      pseudoElements: {}, children: [], frame: { width: 1280, height: 720, transform: [1, 0, 0, 1, 0, 0] } }
    elements.push(value)
    node.childNodes.forEach((child, childIndex) => {
      if ('tagName' in child) value.children.push({ kind: 'element', index: append(child, [...sourcePath, childIndex], value.style.display) })
      else if (child.nodeName === '#text') value.children.push({ kind: 'text', text: (child as DefaultTreeAdapterTypes.TextNode).value })
    })
    return index
  }
  const capture: HtmlDesignCapture = { viewport: { width: 1280, height: 720 }, body: append(body, []), pageStyle: {}, elements, diagnostics: [] }
  const assembly = assembleMeasuredHtml(capture, { html })
  const result = assemblyContentDraft(assembly, { 'bg.png': 'bg', 'fg.png': 'fg' }, { createFormulaId: () => 'formula', definitions: {} })
  return { assembly, draft: result.draft }
}
const htmlOf = (draft: ContentObjectDraft) => typeof draft.data.html === 'string' ? draft.data.html : ''

it('keeps the z5 foreground context atomic and places its z2 gradient after z1 background', () => {
  const { assembly, draft } = measured(`<div id="page" style="position:relative;background-color:#020617">
    <img id="background" src="bg.png" style="position:absolute;z-index:1">
    <div id="gradient" style="position:absolute;z-index:2;background-image:linear-gradient(black,transparent)"></div>
    <div id="foreground" style="position:relative;z-index:5;display:flex">
      <h1>可编辑标题</h1><img src="fg.png" style="position:absolute;z-index:-20">
    </div>
  </div>`)
  const page = assembly.root.children[0]!, foreground = page.children.find(value => value.sourcePath.join('.') === '0.5')!
  expect(foreground.kind).toBe('group')
  expect(foreground.stacking?.zIndex).toBe('5')
  expect(foreground.children.map(value => value.kind)).toEqual(['text', 'image'])
  const pageDraft = draft.children![0]!, children = pageDraft.children!
  expect(children.map(value => value.definitionId)).toEqual([IMAGE_DEFINITION.id, WEB_DEFINITION.id, WEB_DEFINITION.id])
  expect(htmlOf(children[1]!)).toContain('id="gradient"')
  expect(htmlOf(children[2]!)).toContain('id="foreground"')
  expect(htmlOf(pageDraft)).not.toContain('id="gradient"')
  expect(children[2]!.children!.map(value => value.definitionId)).toEqual([IMAGE_DEFINITION.id, TEXT_DEFINITION.id])
  expect(children[2]!.children![1]!.data).toMatchObject({ content: { inlines: [{ type: 'text', text: '可编辑标题' }] } })
  expect(children.every(value => value.style?.['z-index'] === undefined)).toBe(true)
})

it('preserves a positive-z full-screen foreground image and the later overlay, without a background heuristic', () => {
  const { draft } = measured(`<img id="foreground" src="fg.png" style="position:absolute;z-index:8">
    <div id="overlay" style="position:absolute;z-index:9;background-color:rgba(0,0,0,.5)"></div>
    <h1>下层文字</h1><img src="bg.png" style="position:absolute;z-index:1">`)
  expect(draft.children!.map(value => value.definitionId)).toEqual([TEXT_DEFINITION.id, IMAGE_DEFINITION.id, IMAGE_DEFINITION.id, WEB_DEFINITION.id])
  expect(draft.children![2]!.data).toMatchObject({ assetId: 'fg' })
  expect(draft.children![2]!.frame).toMatchObject({ width: 1280, height: 720 })
  expect(htmlOf(draft.children![3]!)).toContain('id="overlay"')
})

it('keeps ordinary block backgrounds below text and only detaches paint that CSS can interleave', () => {
  const { draft } = measured(`<div id="first" style="background-color:red;z-index:99;order:99"></div>
    <h1 style="z-index:-99;order:-99">普通文字</h1>
    <div id="last" style="background-color:blue"></div>`)
  expect(draft.children!.map(value => value.definitionId)).toEqual([TEXT_DEFINITION.id])
  expect(htmlOf(draft)).toContain('id="first"')
  expect(htmlOf(draft)).toContain('id="last"')
  const overlap = measured('<h1 style="height:40px;margin:0">标题</h1><div style="height:40px;margin-top:-40px;background-color:red"></div>')
  expect(overlap.draft.children!.map(value => value.definitionId)).toEqual([TEXT_DEFINITION.id])
  expect(htmlOf(overlap.draft)).toContain('background-color:red')
  expect(htmlOf(overlap.draft)).toContain('position:static;width:100%;height:100%')
  const positioned = measured('<div id="first" style="position:relative;background-color:red"></div><h1>标题</h1><div id="last" style="position:relative;background-color:blue"></div>')
  expect(positioned.draft.children!.map(value => value.definitionId)).toEqual([TEXT_DEFINITION.id, WEB_DEFINITION.id, WEB_DEFINITION.id])
  expect(htmlOf(positioned.draft.children![1]!)).toContain('id="first"')
  expect(htmlOf(positioned.draft.children![2]!)).toContain('id="last"')
  const flex = measured(`<div style="display:flex"><div id="context" style="z-index:0;order:1"><h1>flex文字</h1></div></div>`)
  expect(flex.assembly.root.children[0]!.stacking).toEqual({ zIndex: '0', layoutOrder: '1', positioned: true })
  expect(flex.assembly.root.children[0]!.kind).toBe('group')
})
