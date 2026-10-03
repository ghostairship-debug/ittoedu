// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import { walkComposition, type CompositionNode, type WebComposition } from '../../src/shared/composition/content'
import { createWebCompositionSchema } from '../../src/shared/composition/schema'
import { nativeElementContentSchema } from '../../src/shared/contracts/course-project-v9/schema'

function composition(html: string, previous?: WebComposition<never>) {
  const parsed = parseWebComposition({ html, previous })
  if (parsed.kind !== 'composition') throw new Error(`Unexpected program: ${parsed.reason}`)
  return parsed.composition
}
function nodes(content: WebComposition<never>): CompositionNode<never>[] {
  const result: CompositionNode<never>[] = []
  walkComposition(content.root, node => result.push(node))
  return result
}
function element(content: WebComposition<never>, tagName: string, htmlId?: string) {
  const node = nodes(content).find(node => node.kind === 'element' && node.tagName === tagName
    && (htmlId === undefined || node.attributes.id === htmlId))
  if (node?.kind !== 'element') throw new Error(`Missing ${tagName} ${htmlId ?? ''}`)
  return node
}

describe('HTML to editable Web composition', () => {
  it('persists real CSS, HTML/SVG/template semantics, existing resource bindings and optional typed components without author IDs', () => {
    const css = '.cards{display:grid;grid-template-columns:2fr 3fr;gap:24px}@media(max-width:600px){.cards{display:block}}'
    const html = `<!--before--><!DOCTYPE html><html lang="zh"><head><style>${css}</style></head><body>
      <main class="cards"><p title="a &amp; b">A &lt; B</p><img src="cw-resource:photo" alt="示意图"></main>
      <svg viewBox="0 0 120 80"><use xlink:href="#arrow"/></svg>
      <template><p>尚未显示</p><script>runOnlyAfterInstantiation()</script></template>
      <guoling-document class="prose">{"blocks":[{"type":"paragraph","content":{"inlines":[{"type":"text","text":"课堂观察"}]}}]}</guoling-document>
      <guoling-chart style="width:100%;height:300px"><script type="application/json">{"title":"观察次数","categories":["甲","乙"],"series":[{"name":"次数","values":[3,5]}]}</script></guoling-chart>
      <guoling-native>{"nativeType":"unknown"}</guoling-native>
      <script type="application/ld+json">{"description":"onload is ordinary data"}</script>
    </body></html><!--after-->`
    const assets = { photo: { assetId: 'asset-photo' } }
    const result = parseWebComposition({ html, assets })
    expect(result.kind).toBe('composition')
    if (result.kind !== 'composition') return
    // Exercise the formal persistence representation, not a source-string equality gate.
    const saved = createWebCompositionSchema(nativeElementContentSchema, z.never()).parse(JSON.parse(JSON.stringify(result.composition)))
    expect(saved.doctype).toBe('<!DOCTYPE html>')
    expect(saved.root.kind).toBe('element')
    expect(element(saved, '#document').children.filter(node => node.kind === 'comment').map(node => node.text)).toEqual(['before', 'after'])
    expect(element(saved, 'style').children).toEqual([expect.objectContaining({ kind: 'text', text: css })])
    expect(element(saved, 'p').attributes.title).toBe('a & b')
    expect(element(saved, 'p').children[0]).toMatchObject({ kind: 'text', text: 'A < B' })
    expect(element(saved, 'svg')).toMatchObject({ namespace: 'http://www.w3.org/2000/svg', attributes: { viewBox: '0 0 120 80' } })
    expect(element(saved, 'use').attributes['xlink:href']).toBe('#arrow')
    expect(element(saved, 'template').children.map(node => node.kind === 'element' ? node.tagName : node.kind)).toEqual(['p', 'script'])
    expect(element(saved, 'img').attributes.src).toBe('cw-resource:photo')
    expect(saved.assets).toEqual(assets)
    const doc = element(saved, 'guoling-document').children[0]!
    expect(doc).toMatchObject({ kind: 'document', content: { blocks: [{ id: expect.any(String), type: 'paragraph' }] } })
    const chart = element(saved, 'guoling-chart').children[0]!
    expect(chart).toMatchObject({ kind: 'native', content: { nativeType: 'chart', data: { title: '观察次数', series: [{ points: [{ value: 3 }, { value: 5 }] }] } } })
    expect(element(saved, 'guoling-native').children[0]).toMatchObject({ kind: 'text', text: '{"nativeType":"unknown"}' })
    expect(result.diagnostics.map(item => item.code)).toEqual(['web-component-content'])
    result.composition.assets.photo!.assetId = 'edited'
    expect(assets.photo.assetId).toBe('asset-photo')
  })

  it('keeps whole runnable HTML for real programs while accepting inert data and CSS behavior as composition', () => {
    for (const html of [
      '<script>window.answer = 42</script><button>Reveal</button>',
      '<script type="module" src="./lesson.js"></script>',
      '<button onclick="reveal()">Reveal</button>',
      '<svg><a xlink:href="javascript:reveal()">Reveal</a></svg>',
      '<iframe srcdoc="&lt;script&gt;reveal()&lt;/script&gt;"></iframe>',
    ]) {
      const result = parseWebComposition({ html })
      expect(result).toMatchObject({ kind: 'program', html })
    }
    expect(parseWebComposition({ html: '<style>@keyframes move{to{transform:translateX(80px)}}</style><script type="application/json">{"script":"ordinary data"}</script><details><summary>Reveal</summary>Answer</details>' }).kind).toBe('composition')
  })

  it('preserves unambiguous identities across source edits, insertions and reordering without attaching source markers', () => {
    const first = composition('<main><h1>Title</h1><article id="alpha"><p>Original</p></article><article id="beta"><p>Other</p></article><footer>End</footer></main>')
    const firstSnapshot = structuredClone(first)
    const second = composition('<main><aside>New</aside><h1>Changed title</h1><article id="beta"><p>Other</p></article><article id="alpha"><p>Revised</p></article><footer>End</footer></main>', first)
    expect(element(second, 'main').id).toBe(element(first, 'main').id)
    expect(element(second, 'h1').id).toBe(element(first, 'h1').id)
    expect(element(second, 'h1').children[0]!.id).toBe(element(first, 'h1').children[0]!.id)
    for (const id of ['alpha', 'beta']) {
      expect(element(second, 'article', id).id).toBe(element(first, 'article', id).id)
      expect(element(second, 'article', id).children[0]!.id).toBe(element(first, 'article', id).children[0]!.id)
    }
    expect(new Set(nodes(second).map(node => node.id)).size).toBe(nodes(second).length)
    expect(first).toEqual(firstSnapshot)
    expect(nodes(second).filter(node => node.kind === 'element').every(node => !Object.keys(node.attributes).some(key => key.startsWith('data-courseware-')))).toBe(true)
    const ambiguous = composition('<main><p>Old A</p><p>Old B</p></main>')
    const replaced = composition('<main><p>New A</p><p>New B</p></main>', ambiguous)
    const oldParagraphIds = new Set(nodes(ambiguous).filter(node => node.kind === 'element' && node.tagName === 'p').map(node => node.id))
    expect(nodes(replaced).filter(node => node.kind === 'element' && node.tagName === 'p').every(node => !oldParagraphIds.has(node.id))).toBe(true)
    const componentHtml = '<guoling-document>{"blocks":[{"type":"paragraph","content":{"inlines":[{"type":"text","text":"Original"}]}}]}</guoling-document><guoling-chart>{"categories":["A","B"],"series":[{"name":"Values","values":[3,5]}]}</guoling-chart>'
    const original = composition(componentHtml)
    const edited = composition(componentHtml.replace('Original', 'Revised').replace('[3,5]', '[7,5]'), original)
    const originalDoc = element(original, 'guoling-document').children[0]!
    const editedDoc = element(edited, 'guoling-document').children[0]!
    if (originalDoc.kind !== 'document' || editedDoc.kind !== 'document') throw new Error('Expected document')
    expect(editedDoc.content.blocks[0]!.id).toBe(originalDoc.content.blocks[0]!.id)
    const originalChart = element(original, 'guoling-chart').children[0]!
    const editedChart = element(edited, 'guoling-chart').children[0]!
    if (originalChart.kind !== 'native' || editedChart.kind !== 'native' || originalChart.content.nativeType !== 'chart' || editedChart.content.nativeType !== 'chart') throw new Error('Expected chart')
    expect(editedChart.content.data.categories).toEqual(originalChart.content.data.categories)
    expect(editedChart.content.data.series[0]!.id).toBe(originalChart.content.data.series[0]!.id)
    expect(editedChart.content.data.series[0]!.points[0]).toEqual({ ...originalChart.content.data.series[0]!.points[0], value: 7 })
  })
})
