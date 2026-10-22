// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { scanHtmlSource } from '../../src/shared/html/htmlSourceScanner'
import { projectCompiledHtmlPreviewAssets } from '../../src/main/workbench/htmlPreview/compiledHtmlPreviewAssets'

const dataUrl = (text: string) => `data:image/webp;base64,${Buffer.from(text).toString('base64')}`
const originalRuntime = '<script>window.originalRuntime = true; /* keep this source */</script>'
const source = (data: unknown) => `<!doctype html><html><body><script id="course-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>${originalRuntime}</body></html>`
function courseData(html: string) {
  const tokens = scanHtmlSource(html).tokens
  const index = tokens.findIndex(token => token.kind === 'start-tag' && token.attributes?.some(attribute => attribute.name === 'id' && attribute.decodedValue === 'course-data'))
  const body = tokens[index + 1]!
  return JSON.parse(html.slice(body.span.start, body.span.end))
}

it('projects only compiled asset addresses and serves the original bytes lazily under one deterministic duplicate identity', () => {
  const first = dataUrl('first image'), other = dataUrl('other image')
  const artifact = { format: 'compiled-course-v1', course: { schemaVersion: 3, assets: {
    z: { url: first, width: 300 }, a: { url: first, width: 300 }, b: { url: other }, remote: { url: 'https://media.example/photo.png' },
  } }, title: 'Keep <source> and unknown fields', nativeSources: { original: 'unchanged' } }
  const html = source(artifact), address = vi.fn((id: string) => `courseware-preview://lease/token/_asset/${id}`)
  const projected = projectCompiledHtmlPreviewAssets(html, address)
  const data = courseData(projected.source)
  expect(address.mock.calls.map(([id]) => id)).toEqual(['a', 'b'])
  expect([...projected.assets.keys()]).toEqual(['a', 'b'])
  expect(data.course.assets.a.url).toBe('courseware-preview://lease/token/_asset/a')
  expect(data.course.assets.z.url).toBe(data.course.assets.a.url)
  expect(data.course.assets.remote.url).toBe(artifact.course.assets.remote.url)
  expect(data.title).toBe(artifact.title)
  expect(data.nativeSources).toEqual(artifact.nativeSources)
  expect(data.course.schemaVersion).toBe(3)
  expect(projected.source.endsWith(`${originalRuntime}</body></html>`)).toBe(true)
  expect(projected.assets.get('a')!.contentType).toBe('image/webp')
  expect(Buffer.from(projected.assets.get('a')!.bytes).toString()).toBe('first image')
  expect(projected.assets.get('a')!.bytes).toBe(projected.assets.get('a')!.bytes)
  expect(courseData(html)).toEqual(artifact)
})

it('keeps ordinary, malformed and unrelated JSON HTML on their existing source carrier', () => {
  const ordinary = '<script id="course-data" type="application/json">{"title":"ordinary"}</script><p>Editable</p>'
  for (const html of [ordinary, '<p>compiled-course-v1 course-data</p>', source({ format: 'another-format', course: { assets: { a: { url: dataUrl('image') } } } }),
    source({ format: 'compiled-course-v1', course: { assets: { a: { url: 'data:application/javascript;base64,YWxlcnQoMSk=' } } } }),
    source({ format: 'compiled-course-v1', course: { assets: { a: { url: 'data:image/svg+xml,%3Csvg%3E' } } } })]) {
    const projected = projectCompiledHtmlPreviewAssets(html, () => { throw new Error('unrelated content must not receive a lease') })
    expect(projected.source).toBe(html)
    expect(projected.assets.size).toBe(0)
  }
})

it('preserves the data URI carrier used by an existing saved image record while projecting its siblings', () => {
  const original = dataUrl('image with an existing edit'), sibling = dataUrl('other image')
  const records = { version: 1, records: { saved: { kind: 'image', binding: { kind: 'dom',
    path: [{ tag: 'body', index: 1 }, { tag: 'img', index: 0 }], baseline: original }, overrides: { src: 'replacement.png' } } } }
  const wrapper = `<script id="cw-html-authoring-records" type="application/json">${JSON.stringify(records)}</script>`
  const html = source({ format: 'compiled-course-v1', course: { assets: { a: { url: original }, duplicate: { url: original }, b: { url: sibling } } } })
    .replace('</body>', `${wrapper}</body>`)
  const projected = projectCompiledHtmlPreviewAssets(html, id => `courseware-preview://lease/token/_asset/${id}`)
  const data = courseData(projected.source)
  expect(data.course.assets.a.url).toBe(original)
  expect(data.course.assets.duplicate.url).toBe(original)
  expect(data.course.assets.b.url).toBe('courseware-preview://lease/token/_asset/b')
  expect([...projected.assets.keys()]).toEqual(['b'])
  expect(projected.source).toContain(wrapper)
})
