import PptxGenJS from 'pptxgenjs'
import { strToU8 } from 'fflate'
import { OfficePackage, children, descendants, NS } from '../../src/main/workbench/office/officePackage'

/** Real chart + embedded editable workbook, an animation and opaque non-target content. */
export async function complexPptxFixture(): Promise<Uint8Array> {
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_WIDE'
  const slide = deck.addSlide()
  slide.addText('Complex original title', { x: .7, y: .5, w: 10, h: .7, fontSize: 26, objectName: 'title' })
  slide.addChart(deck.ChartType.bar, [{ name: 'Revenue', labels: ['One', 'Two', 'Three'], values: [11, 22, 33] }],
    { x: .8, y: 1.8, w: 8, h: 4.5, showTitle: true, title: 'Editable embedded chart', objectName: 'revenue-chart' })
  const second = deck.addSlide(); second.addText('Untouched second page', { x: 1, y: 1, w: 8, h: 1, fontSize: 24 })
  const bytes = await deck.write({ outputType: 'uint8array' })
  if (!(bytes instanceof Uint8Array)) throw new Error('fixture did not return bytes')
  const pkg = new OfficePackage(bytes), part = 'ppt/slides/slide1.xml', xml = pkg.xml(part)
  const title = descendants(xml, NS.slide, 'cNvPr').find(node => node.getAttribute('name') === 'title')!
  const e = (name: string, attrs: Record<string, string> = {}) => {
    const node = xml.createElementNS(NS.slide, 'p:' + name)
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
    return node
  }
  const timing = e('timing'), list = e('tnLst'), par = e('par'), root = e('cTn', { id: '1', dur: 'indefinite', restart: 'never', nodeType: 'tmRoot' })
  const child = e('childTnLst'), effect = e('animEffect', { transition: 'in', filter: 'fade' }), behavior = e('cBhvr')
  behavior.appendChild(e('cTn', { id: '2', dur: '500', fill: 'hold' }))
  const target = e('tgtEl'); target.appendChild(e('spTgt', { spid: title.getAttribute('id')! })); behavior.appendChild(target)
  effect.appendChild(behavior); child.appendChild(effect); root.appendChild(child); par.appendChild(root); list.appendChild(par); timing.appendChild(list)
  xml.documentElement.insertBefore(timing, children(xml.documentElement, NS.slide, 'extLst')[0] ?? null); pkg.write(part)
  const types = pkg.xml('[Content_Types].xml'), bin = types.createElementNS(types.documentElement.namespaceURI, 'Default')
  bin.setAttribute('Extension', 'bin'); bin.setAttribute('ContentType', 'application/octet-stream'); types.documentElement.appendChild(bin); pkg.write('[Content_Types].xml')
  pkg.setBinary('customXml/opaque.bin', strToU8('opaque-original-sentinel'))
  pkg.setBinary('custom/vendor-content.bin', strToU8('unknown-vendor-sentinel'))
  return pkg.save()
}
