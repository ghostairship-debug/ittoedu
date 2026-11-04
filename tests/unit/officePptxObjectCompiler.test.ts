import { beforeAll, expect, it } from 'vitest'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { applyOfficeObjectEditOffThread, inspectOfficeObjectSourceOffThread } from '../../src/main/workbench/office/officeContentWorker'
import { applyOfficeObjectEdit, inspectOfficeObjectSource } from '../../src/main/workbench/office/officeObjectCompiler'
import { children, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'
import { objects } from '../../src/main/workbench/office/pptxContent'

const slide = 'ppt/slides/slide1.xml'
const fieldId = '{A3461111-1927-4411-9270-9AF2BD9B6ADB}'
let original: Uint8Array
beforeAll(async () => {
  const pkg = new OfficePackage(await complexPptxFixture())
  const paragraph = objects(pkg, slide).find(object => object.name === 'title')!.paragraphs[0]!
  const run = children(paragraph, NS.drawing, 'r')[0]!
  const field = pkg.xml(slide).createElementNS(NS.drawing, 'a:fld')
  field.setAttribute('id', fieldId); field.setAttribute('type', 'slidenum')
  for (const child of Array.from(run.childNodes)) field.appendChild(child.cloneNode(true))
  children(field, NS.drawing, 't')[0]!.textContent = '1'
  paragraph.replaceChild(field, run)
  pkg.write(slide); original = pkg.save()
})

it('round-trips an existing auto field that the structured text path cannot edit', async () => {
  const deck = inspectOfficeContent(original, 'pptx')
  if (deck.format !== 'pptx') throw new Error('wrong fixture format')
  const page = deck.slides[0]!, object = page.shapes.find(shape => shape.name === 'title')!
  const field = object.autoFields![0]!
  expect(field).toMatchObject({ type: 'slidenum', text: '1', id: fieldId })
  const target = { slide: 0, shapeId: object.shapeId, part: page.part, partVersion: page.partVersion }
  await expect(applyOfficeContent(original, { format: 'pptx', operation: 'edit',
    edits: [{ ...target, type: 'text', text: '2026-11-04' }] })).rejects.toThrow('自动域')
  const source = await inspectOfficeObjectSourceOffThread(original, { format: 'pptx', target: { slide: 0, shapeId: object.shapeId } })
  expect(source).toMatchObject({ format: 'pptx', target })
  if (source.format !== 'pptx') throw new Error('wrong source format')
  expect(source.xml).toContain(fieldId)
  const xml = field.xml.replace('type="slidenum"', 'type="datetime1"').replace('>1</a:t>', '>2026-11-04</a:t>')
  const edited = await applyOfficeObjectEditOffThread(original, { format: 'pptx', target, edit: { path: field.path, xml } })
  expect(edited.changedParts).toEqual([slide])
  const updated = inspectOfficeContent(edited.bytes, 'pptx')
  if (updated.format !== 'pptx') throw new Error('wrong result format')
  expect(updated.slides[0]?.shapes.find(shape => shape.shapeId === object.shapeId)).toMatchObject({
    text: '2026-11-04', autoFields: [{ id: fieldId, type: 'datetime1', text: '2026-11-04' }],
  })
  expect(updated.slides[0]?.animations).toEqual(page.animations)
  expect(updated.slides[0]?.shapes.find(shape => shape.name === 'revenue-chart')).toEqual(page.shapes.find(shape => shape.name === 'revenue-chart'))
  const beforeParts = new OfficePackage(original).parts, afterParts = new OfficePackage(edited.bytes).parts
  expect(Object.keys(afterParts).sort()).toEqual(Object.keys(beforeParts).sort())
  for (const name of Object.keys(beforeParts).filter(name => name !== slide)) expect(afterParts[name], name).toEqual(beforeParts[name])
}, 25_000)

it('refuses stale slides and genuinely broken shape or relationship references', () => {
  const deck = inspectOfficeContent(original, 'pptx')
  if (deck.format !== 'pptx') throw new Error('wrong fixture format')
  const page = deck.slides[0]!, title = page.shapes.find(shape => shape.name === 'title')!, field = title.autoFields![0]!
  const target = { slide: 0, part: page.part, partVersion: page.partVersion, shapeId: title.shapeId }
  expect(() => applyOfficeObjectEdit(original, { format: 'pptx', target: { ...target, partVersion: '0'.repeat(64) },
    edit: { path: field.path, xml: field.xml } })).toThrow('位置或版本已改变')
  expect(() => applyOfficeObjectEdit(original, { format: 'pptx', target,
    edit: { path: [], xml: null } })).toThrow('引用了不存在的形状')
  expect(() => applyOfficeObjectEdit(original, { format: 'pptx', target,
    edit: { path: [], insert: 'after', xml: '<p:sp/>' } })).toThrow('缺少 nvSpPr/cNvPr')
  const shapeId = page.shapes.find(shape => shape.name === 'revenue-chart')!.shapeId
  expect(() => applyOfficeObjectEdit(original, { format: 'pptx', target: { ...target, shapeId },
    edit: { path: [{ name: 'a:graphic', index: 0 }, { name: 'a:graphicData', index: 0 }],
      xml: '<a:graphicData r:id="missingLink" />' } })).toThrow('不存在的关系')
})

it('adds and reorders target child nodes and attaches a hyperlink without replacing another shape', () => {
  const source = new OfficePackage(original)
  const shape = objects(source, slide).find(value => value.name === 'title')!
  const observed = inspectOfficeObjectSource(original, { format: 'pptx', target: { slide: 0, shapeId: shape.shapeId } })
  if (observed.format !== 'pptx') throw new Error('wrong source format')
  const rid = 'rIdNewObjectLink'
  const edited = applyOfficeObjectEdit(original, { format: 'pptx', target: observed.target, edit: {
    path: [{ name: 'p:txBody', index: 0 }, { name: 'a:p', index: 0 }],
    xml: `<a:p><a:r><a:rPr><a:hlinkClick r:id="${rid}"/></a:rPr><a:t>New link</a:t></a:r><a:r><a:t> second run</a:t></a:r></a:p>`,
    dependencies: { relationships: [{ id: rid, type: NS.officeRelationship + '/hyperlink', target: 'https://example.com/', targetMode: 'External' }] },
  } })
  expect(edited.changedParts).toEqual(['ppt/slides/_rels/slide1.xml.rels', slide])
  const result = new OfficePackage(edited.bytes)
  const paragraph = objects(result, slide).find(value => value.shapeId === shape.shapeId)!.paragraphs[0]!
  expect(children(paragraph, NS.drawing, 'fld')).toHaveLength(0)
  expect(children(paragraph, NS.drawing, 'r').map(node => node.textContent)).toEqual(['New link', ' second run'])
  expect(inspectOfficeObjectSource(edited.bytes, { format: 'pptx', target: { slide: 0, shapeId: shape.shapeId } }).relationships)
    .toContainEqual({ id: rid, type: NS.officeRelationship + '/hyperlink', target: 'https://example.com/', targetMode: 'External' })
  expect(result.parts['ppt/charts/chart1.xml']).toEqual(source.parts['ppt/charts/chart1.xml'])
  const reorderedSource = inspectOfficeObjectSource(edited.bytes, { format: 'pptx', target: { slide: 0, shapeId: shape.shapeId } })
  if (reorderedSource.format !== 'pptx') throw new Error('wrong source format')
  const reordered = applyOfficeObjectEdit(edited.bytes, { format: 'pptx', target: reorderedSource.target, edit: {
    path: [{ name: 'p:txBody', index: 0 }, { name: 'a:p', index: 0 }],
    xml: `<a:p><a:r><a:t> second run</a:t></a:r><a:r><a:rPr><a:hlinkClick r:id="${rid}"/></a:rPr><a:t>New link</a:t></a:r></a:p>`,
  } })
  const reorderedRuns = objects(new OfficePackage(reordered.bytes), slide).find(value => value.shapeId === shape.shapeId)!.paragraphs[0]!
  expect(children(reorderedRuns, NS.drawing, 'r').map(node => node.textContent)).toEqual([' second run', 'New link'])
})

it('edits a chart dependency by retargeting a private copy and preserves its embedded workbook', () => {
  const originalPkg = new OfficePackage(original)
  const shape = objects(originalPkg, slide).find(value => value.name === 'revenue-chart')!
  const sibling = shape.node.cloneNode(true) as Element
  const siblingIdentity = sibling.getElementsByTagNameNS(NS.slide, 'cNvPr')[0]!
  siblingIdentity.setAttribute('id', '99')
  siblingIdentity.setAttribute('name', 'Shared chart sibling')
  shape.node.parentNode!.appendChild(sibling)
  originalPkg.write(slide)
  const baseline = originalPkg.save()
  const target = { slide: 0, shapeId: shape.shapeId }
  const observed = inspectOfficeObjectSource(baseline, { format: 'pptx', target })
  if (observed.format !== 'pptx') throw new Error('wrong source format')
  const existing = observed.relationships.find(relation => relation.type.endsWith('/chart'))!
  const { dependencySource: chart } = inspectOfficeObjectSource(baseline, { format: 'pptx', target, dependency: existing.part })
  if (!chart?.xml) throw new Error('missing chart XML')
  expect(chart.relationships.some(relation => relation.part?.endsWith('.xlsx'))).toBe(true)
  const privateChart = 'ppt/charts/chartPrivate.xml', rid = 'rIdPrivateChart'
  const edited = applyOfficeObjectEdit(baseline, { format: 'pptx', target: observed.target, edit: {
    path: ['a:graphic', 'a:graphicData', 'c:chart'].map(name => ({ name, index: 0 })),
    xml: `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/>`,
    dependencies: {
      relationships: [{ id: rid, type: existing.type, target: '../charts/chartPrivate.xml' }],
      parts: [{ path: privateChart, contentType: chart.contentType,
        xml: chart.xml.replace('Editable embedded chart', 'Updated private chart'),
        relationships: chart.relationships.map(({ part: _part, ...relationship }) => relationship) }],
    },
  } })
  const pkg = new OfficePackage(edited.bytes)
  expect(pkg.parts[existing.part!]).toEqual(originalPkg.parts[existing.part!])
  expect(inspectOfficeObjectSource(edited.bytes, { format: 'pptx', target: { slide: 0, shapeId: '99' } }).relationships).toEqual([existing])
  const workbook = chart.relationships.find(relation => relation.part?.endsWith('.xlsx'))!.part!
  expect(pkg.parts[workbook]).toEqual(originalPkg.parts[workbook])
  expect(inspectOfficeObjectSource(edited.bytes, { format: 'pptx', target, dependency: privateChart }).dependencySource?.xml)
    .toContain('Updated private chart')
  expect(inspectOfficeContent(edited.bytes, 'pptx')).toMatchObject({ format: 'pptx' })
  const changed = inspectOfficeObjectSource(edited.bytes, { format: 'pptx', target })
  if (changed.format !== 'pptx') throw new Error('wrong source format')
  const cleanup = applyOfficeObjectEdit(edited.bytes, { format: 'pptx', target: changed.target, edit: {
    path: [{ name: 'a:graphic', index: 0 }, { name: 'a:graphicData', index: 0 }],
    xml: `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${existing.id}"/></a:graphicData>`,
    dependencies: { removeRelationships: [rid], removeParts: [privateChart] },
  } })
  const cleaned = new OfficePackage(cleanup.bytes)
  expect(cleaned.parts[privateChart]).toBeUndefined()
  expect(cleaned.parts[workbook]).toEqual(originalPkg.parts[workbook])
  expect(inspectOfficeObjectSource(cleanup.bytes, { format: 'pptx', target }).relationships).toEqual([existing])
})
