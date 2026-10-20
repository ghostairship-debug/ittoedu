// @vitest-environment node
import { expect, it } from 'vitest'
import { parse } from 'parse5'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFileSummary, projectHtmlProjection } from '../../src/core/projectFiles/componentPlatform/projection'

it.each([
  ['<head><title>hidden</title><body><p>Visible &amp; 中文</p>', 'Visible & 中文'],
  ['<script><!--<script>hidden</script>LEAK--></script><p>Visible</p>', 'Visible'],
  ['<template>hidden<template>hidden</template></template><textarea>A&amp;B</textarea><p>After</p>', 'A&B After'],
  ['<table>before<tr><td>cell</td></tr>after</table>', 'beforeafter cell'],
  ['<p>a<2b</p>', 'a<2b'],
  [`<p>${'正文'.repeat(300)}</p><script>hidden</script>`, '正文'.repeat(90)],
])('preserves parser-visible summary semantics for %s', (content, expected) => {
  expect(componentProjectFileSummary({ kind: 'html', content })).toBe(expected)
})

it('keeps nested projection paths, fostered text, entities and raw scripts with compact parser text', () => {
  const project = createBlankCourseProjectV10('Projection text')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  const text = 'long 中文 & value '.repeat(1024)
  project.instances.parent = { id: 'parent', definitionId: WEB_DEFINITION.id, data: {
    html: `<section><p>${text}</p><table>before<tr><td>cell</td></tr>after</table><script>const value = "<&";</script><style>.test::after{content:"<&"}</style></section>`,
  }, childIds: ['child'] }
  project.instances.child = { id: 'child', definitionId: WEB_DEFINITION.id, data: { html: '<span>Child &amp; text</span>' } }
  const projection = projectHtmlProjection(project, ['parent'])!
  expect(projection.entries.map(entry => entry.instanceId)).toEqual(['parent', 'child'])
  const root = parse(projection.html), html = root.childNodes.find(node => 'tagName' in node && node.tagName === 'html')!
  if (!('childNodes' in html)) throw new Error('Expected document')
  const body = html.childNodes.find(node => 'tagName' in node && node.tagName === 'body')!
  for (const entry of projection.entries) {
    let node: any = body
    for (const index of entry.sourcePath) node = node.childNodes[index]
    expect(node.attrs.find((attribute: any) => attribute.name === 'id')?.value).toBe(`guoling-object-${entry.instanceId}`)
  }
  expect(projection.html).toContain('const value = "<&";')
  expect(projection.html).toContain('.test::after{content:"<&"}')
  expect(projection.html).toContain('beforeafter<table>')
  expect(projection.html).toContain('Child &amp; text')
  expect(projection.html).toContain('long 中文 &amp; value ')
})
