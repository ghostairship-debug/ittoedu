import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { resolveFlowDocxPageBox } from '../../src/renderer/export/flowPageBox'
import { imageDataSchema } from '../../src/components/image/data'

it('anchors V10 floating content to its nested paragraph and retains viewport and repeating teacher placement', async () => {
  const text = (value: string) => ({ content: { inlines: [{ type: 'text', text: value }] } })
  const source = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'anchored-word', revision: 0, title: '锚点',
    definitions: Object.fromEntries(['text', 'document-block', 'group', 'teacher-controller', 'image'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      outer: { id: 'outer', definitionId: 'guoling.document-block', data: { type: 'section', title: { inlines: [{ type: 'text', text: 'Outer title' }] }, collapsedByDefault: false }, childIds: ['inner'] },
      inner: { id: 'inner', definitionId: 'guoling.text', data: text('Inner body') },
      group: { id: 'group', definitionId: 'guoling.group', data: {}, frame: { width: 120, height: 40, transform: [1, 0, 0, 1, 20, 500] },
        flowPlacement: { space: 'paper', plane: 'underlay', paragraphAnchor: { blockId: 'inner', offsetY: 26, xRatio: 0.4 } }, childIds: ['anchored'] },
      anchored: { id: 'anchored', definitionId: 'guoling.text', data: text('Anchor drawing'), frame: { width: 120, height: 40, transform: [1, 0, 0, 1, 0, 0] } },
      viewport: { id: 'viewport', definitionId: 'guoling.text', data: text('Viewport drawing'), frame: { width: 120, height: 40, transform: [1, 0, 0, 1, 30, 70] }, flowPlacement: { space: 'viewport', plane: 'overlay' } },
      picture: { id: 'picture', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'artwork', originalAssetId: 'artwork', alt: '浮层图片' }), frame: { width: 80, height: 50, transform: [1, 0, 0, 1, 300, 300] }, flowPlacement: { space: 'paper', plane: 'overlay' }, flowLayout: { width: 'content-width', caption: { inlines: [{ type: 'text', text: '浮层图片题注' }] } } },
      rotated: { id: 'rotated', definitionId: 'guoling.image', data: imageDataSchema.parse({ assetId: 'artwork', originalAssetId: 'artwork', alt: '旋转图片' }), frame: { width: 80, height: 50, transform: [0, 1, -1, 0, 300, 300] }, flowPlacement: { space: 'paper', plane: 'overlay' } },
      teacher: { id: 'teacher', definitionId: 'guoling.teacher-controller', data: { includeInStaticExports: true }, frame: { width: 160, height: 30, transform: [1, 0, 0, 1, 0, 0] }, visibility: { mode: 'all', surfaceIds: [] } },
    }, surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['outer', 'group', 'viewport', 'picture', 'rotated'] }], global: { underlay: [], overlay: ['teacher'] }, assets: { artwork: { id: 'artwork', path: 'assets/artwork.png', mimeType: 'image/png' } } })
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cN2kAAAAASUVORK5CYII='), char => char.charCodeAt(0))
  const result = await buildComponentDocx(source, { surfaceId: 'flow', resolveAsset: () => ({ bytes, mimeType: 'image/png' }), captureInstance: async () => ({ bytes, mimeType: 'image/png', width: 160, height: 30 }) })
  const files = unzipSync(result.bytes)
  const parse = (bytes: Uint8Array) => new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  const doc = parse(files['word/document.xml']!)
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  const paragraph = Array.from(doc.getElementsByTagNameNS('*', 'p')).find(p => p.textContent?.includes('Inner body'))!
  const anchor = paragraph.getElementsByTagNameNS('*', 'anchor')[0]!
  expect(anchor).toBeDefined()
  expect(anchor.getAttribute('behindDoc')).toBe('1')
  const positionV = anchor.getElementsByTagNameNS('*', 'positionV')[0]!
  expect(positionV.getAttribute('relativeFrom')).toBe('paragraph')
  expect(positionV.textContent).toBe(String(26 * 9525))
  expect(anchor.getElementsByTagNameNS('*', 'positionH')[0]!.textContent).toBe(String(Math.round(resolveFlowDocxPageBox().maxContentWidthPx * 0.4 * 9525)))
  expect(anchor.textContent).toContain('Anchor drawing')
  const viewport = Array.from(doc.getElementsByTagNameNS('*', 'anchor')).find(a => a.textContent?.includes('Viewport drawing'))!
  expect(viewport.getElementsByTagNameNS('*', 'positionV')[0]!.getAttribute('relativeFrom')).toBe('margin')
  expect(viewport.getElementsByTagNameNS('*', 'positionV')[0]!.textContent).toBe(String(70 * 9525))
  const picture = Array.from(doc.getElementsByTagNameNS('*', 'anchor')).find(a => a.textContent?.includes('浮层图片题注'))!
  expect(picture).toBeDefined()
  expect(picture.getElementsByTagNameNS('*', 'pic')).toHaveLength(1)
  expect(picture.getElementsByTagNameNS('*', 'spAutoFit')).toHaveLength(1)
  expect(picture.getElementsByTagNameNS('*', 'inline')[0]!.getElementsByTagNameNS('*', 'extent')[0]!.getAttribute('cx')).toBe(String(50 * 9525))
  const rotated = Array.from(doc.getElementsByTagNameNS('*', 'anchor')).find(a => a.getElementsByTagNameNS('*', 'docPr')[0]?.getAttribute('name') === 'rotated')!
  expect(rotated.getElementsByTagNameNS('*', 'xfrm')[0]!.getAttribute('rot')).toBe('5400000')
  expect(rotated.getElementsByTagNameNS('*', 'positionH')[0]!.textContent).toBe(String(235 * 9525))
  expect(rotated.getElementsByTagNameNS('*', 'positionV')[0]!.textContent).toBe(String(315 * 9525))
  expect(doc.getElementsByTagNameNS('*', 'footerReference')).toHaveLength(1)
  const footer = parse(files['word/footer1.xml']!)
  expect(footer.getElementsByTagName('parsererror')).toHaveLength(0)
  expect(footer.getElementsByTagNameNS('*', 'anchor')).toHaveLength(1)
  expect(doc.documentElement.textContent).not.toContain('__guoling_word_output__')
  expect(result.fidelity).toBe('complete')
})
