// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { htmlPreviewTargetReportSchema } from '../../src/shared/workbench/htmlPreview'
import type { z } from 'zod'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>

const box = { x: 10, y: 10, left: 10, top: 10, width: 100, height: 25, right: 110, bottom: 35, toJSON: () => ({}) }
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

it('reports iframe text and images through the outer editor without confusing their source paths', () => {
  document.body.innerHTML = '<p>same</p><iframe id="lesson"></iframe>'
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => box })
  const iframe = document.querySelector('iframe')!
  iframe.getBoundingClientRect = () => ({ ...box, width: 400, height: 300, right: 410, bottom: 310 })
  const child = iframe.contentDocument!
  child.head.innerHTML = '<base href="http://localhost:3000/nested/">'
  child.body.innerHTML = '<p>same</p><img src="old.png">'
  Object.defineProperty(child, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: child.querySelector('p')!.firstChild, offset: 0 }) })
  Object.defineProperty(child.defaultView!.Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => box })
  child.querySelector('img')!.getBoundingClientRect = () => box
  const posted: Array<{ event?: string; targets?: HtmlPreviewTargetReport[] }> = []
  vi.spyOn(window.parent, 'postMessage').mockImplementation(message => { posted.push(message) })
  const dispose = mountHtmlPreviewAgent(document)
  try {
    const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }))
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'mode', enabled: true })
    child.querySelector('p')!.dispatchEvent(new child.defaultView!.MouseEvent('dblclick', { bubbles: true, clientX: 15, clientY: 15 }))
    const text = posted.find(value => value.event === 'targets')!.targets![0]!
    expect(text).toMatchObject({ kind: 'text', rawText: 'same', scriptCreated: true, bindingStatus: 'bound' })
    expect(text.authoring?.record.scope?.['html:frame']).toContain('id:lesson')
    expect(text.rect.x).toBeGreaterThanOrEqual(20)
    child.querySelector('img')!.dispatchEvent(new child.defaultView!.MouseEvent('click', { bubbles: true, button: 0 }))
    const image = posted.filter(value => value.event === 'targets').at(-1)!.targets![0]!
    expect(image).toMatchObject({ kind: 'image', rawText: 'old.png', scriptCreated: true, bindingStatus: 'bound' })
    const records = { [image.authoring!.authorKey]: { ...image.authoring!.record, overrides: { src: 'entry.assets/new.png' } } }
    command({ type: 'html-preview.patch', loadId: 'load', handle: image.handle, kind: 'image', expected: 'old.png', value: 'entry.assets/new.png', authoringRecords: records })
    command({ type: 'html-preview.authoring-records', loadId: 'load', records })
    expect(child.querySelector('img')!.src).toBe(new URL('entry.assets/new.png', document.baseURI).href)
    child.querySelector('img')!.dispatchEvent(new child.defaultView!.MouseEvent('click', { bubbles: true, button: 0 }))
    expect(posted.filter(value => value.event === 'targets').at(-1)!.targets![0]!.bindingStatus).toBe('bound')
  } finally { dispose() }
})

it('upgrades only the software consumer while keeping existing author records and original content', () => {
  document.body.innerHTML = '<p>same</p>'
  const authoring = createDomAuthoring(document.documentElement, { records: () => ({}) })
  const observed = authoring.describe(document.querySelector('p')!.firstChild!)!
  const records = { [observed.authorKey]: { ...observed.record, overrides: { text: 'edited' } } }
  const source = '<!doctype html><html><body><p>same</p><script id="cw-html-authoring-records" type="application/json">'
    + JSON.stringify({ version: 1, records }) + '</script><script id="cw-html-authoring-consumer">/* older-single-document */</script></body></html>'
  authoring.dispose()
  const updated = patchHtmlAuthoringRecords(source, records)
  expect(readHtmlAuthoringRecords(updated)).toEqual(records)
  expect(updated).toContain('<!doctype html><html><body><p>same</p>')
  expect(updated).not.toContain('older-single-document')
  expect(updated).toContain('onDocumentsChanged')
  expect(updated.match(/id="cw-html-authoring-consumer"/g)).toHaveLength(1)
})
