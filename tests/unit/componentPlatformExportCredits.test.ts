import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { imageDataSchema } from '../../src/components/image/data'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml, composeComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'

it('preserves asset source attribution in DOCX and print instead of its delivery URL', async () => {
  const source = { kind: 'open-library' as const, attribution: '示意图 © 原作者', author: '原作者',
    url: 'https://example.org/source/artwork', license: { id: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } }
  const base = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'export-credit', revision: 0, title: '来源检查',
    definitions: { image: { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } } },
    instances: { picture: { id: 'picture', definitionId: 'image', data: imageDataSchema.parse({ assetId: 'artwork', originalAssetId: 'artwork', alt: '来源图片' }) } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '来源检查', childIds: ['picture'] }], global: { underlay: [], overlay: [] },
    assets: { artwork: { id: 'artwork', path: 'assets/artwork.png', mimeType: 'image/png', source } } })
  // The remote delivery address serves the same bytes; it is not the source page.
  const document = { ...base, assets: { artwork: { ...base.assets.artwork!, remote: { url: 'https://cdn.example.org/delivery.png' } } } }
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cN2kAAAAASUVORK5CYII='), char => char.charCodeAt(0))
  const options = { surfaceId: 'flow', resolveAsset: () => ({ bytes, mimeType: 'image/png' }) }
  const word = await buildComponentDocx(document, options)
  const xml = new DOMParser().parseFromString(strFromU8(unzipSync(word.bytes)['word/document.xml']!), 'application/xml')
  expect(xml.getElementsByTagName('parsererror')).toHaveLength(0)
  const print = await buildComponentPrintHtml(document, options)
  const html = new DOMParser().parseFromString(print.html, 'text/html')
  for (const text of [xml.documentElement.textContent, html.body.textContent]) {
    expect(text).toContain('素材来源')
    expect(text).toContain(source.attribution)
    expect(text).toContain(source.license.id)
    expect(text).toContain(source.license.url)
    expect(text).toContain(source.url)
    expect(text).not.toContain(document.assets.artwork.remote.url)
  }
  expect(word.fidelity).toBe('complete')
  expect(print.fidelity).toBe('complete')
  const mixed = new DOMParser().parseFromString(composeComponentPrintHtml(document.title, [print.html, print.html]), 'text/html')
  expect(mixed.querySelectorAll('.course-credits')).toHaveLength(1)
  expect(mixed.body.lastElementChild?.classList.contains('course-credits')).toBe(true)
})
