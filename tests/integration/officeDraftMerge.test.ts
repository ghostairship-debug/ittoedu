// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { mergeOfficeContent } from '../../src/main/workbench/office/officeDraftMerge'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'
import { inspectPartRelationships } from '../../src/main/workbench/office/officeNativeDependencies'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'
import { applyOfficeObjectEdit } from '../../src/main/workbench/office/officeObjectCompiler'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

describe('Office draft merge', () => {
  it('merges a delayed AI text edit with a human move of the same shape, then undoes only the AI change', async () => {
    const original = (await applyOfficeContent(undefined, { operation: 'create', format: 'pptx', slides: [{ title: 'Before' }] })).bytes
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-draft-merge-'))
    directories.push(directory)
    const filename = path.join(directory, 'presentation.pptx')
    await fs.writeFile(filename, original)
    const service = new OfficeFileService(new DocumentHostService(path.join(directory, 'owner')))
    const binding = await service.bindWorking(filename, true)
    const observed = await service.inspect(binding, 'pptx', { actor: 'ai' })
    if (observed.inspection.format !== 'pptx') throw new Error('expected PPTX')
    const slide = observed.inspection.slides[0]!, shape = slide.shapes.find(value => value.text === 'Before')!
    const target = { slide: 0, part: slide.part, partVersion: slide.partVersion, shapeId: shape.shapeId }
    const human = await service.edit(binding, { operation: 'edit', format: 'pptx', edits: [{ ...target, type: 'transform', x: 81 }] }, { actor: 'human' })
    expect((await service.inspect(binding, 'pptx', { actor: 'ai' })).observedBytes).toEqual(observed.observedBytes)
    await expect(service.inspect(binding, 'pptx')).rejects.toThrow('草稿已更新')
    const ai = await service.edit(binding, { operation: 'edit', format: 'pptx', edits: [{ ...target, type: 'text', text: 'After' }] },
      { actor: 'ai', observedBytes: observed.observedBytes, expectedVersion: binding.fileVersion })
    expect(ai.applied).toBe(true)
    expect(ai.inspection).toMatchObject({ slides: [{ shapes: expect.arrayContaining([expect.objectContaining({ text: 'After', frame: expect.objectContaining({ x: 81 }) })]) }] })
    expect(await fs.readFile(filename)).toEqual(Buffer.from(original))
    const undone = await service.moveHistory(ai.binding, 'undo')
    expect(await service.readWorking(undone.binding)).toEqual(human.observedBytes)
  }, 25_000)

  it('regenerates an Excel formula cache after both inputs changed independently', async () => {
    const base = (await applyOfficeContent(undefined, { operation: 'create', format: 'xlsx',
      sheets: [{ name: 'Sheet1', rows: [[1, 2, { formula: 'SUM(A1:B1)' }]] }] })).bytes
    const edit = (cell: string, value: number) => applyOfficeContent(base, { operation: 'edit', format: 'xlsx', edits: [{ sheet: 'Sheet1', cell, value }] })
    const proposed = await edit('A1', 10), latest = await edit('B1', 20)
    const merged = mergeOfficeContent(base, proposed, latest.bytes)
    expect(inspectOfficeContent(merged.bytes, 'xlsx')).toMatchObject({ sheets: [{ cells: [
      { cell: 'A1', value: 10 }, { cell: 'B1', value: 20 }, { cell: 'C1', formula: 'SUM(A1:B1)', value: 30 },
    ] }] })
  })

  it('keeps ordinal identity for identical Word paragraphs edited independently', async () => {
    const base = (await applyOfficeContent(undefined, { operation: 'create', format: 'docx',
      blocks: [{ type: 'paragraph', text: 'Same' }, { type: 'paragraph', text: 'Same' }] })).bytes
    const edit = (index: number) => applyOfficeContent(base, { operation: 'edit', format: 'docx', edits: [{ type: 'paragraph', index, text: 'New' }] })
    const proposed = await edit(0), latest = await edit(1)
    const merged = mergeOfficeContent(base, proposed, latest.bytes)
    expect(inspectOfficeContent(merged.bytes, 'docx')).toMatchObject({ paragraphs: [{ text: 'New' }, { text: 'New' }] })
  })

  it('rejects a new reference to a chart dependency that changed since observation', async () => {
    const base = await complexPptxFixture(), part = 'ppt/slides/slide1.xml'
    const proposal = new OfficePackage(base), slide = proposal.xml(part)
    const chart = descendants(slide, NS.slide, 'graphicFrame')[0]!
    const copied = chart.cloneNode(true) as Element
    descendants(copied, NS.slide, 'cNvPr')[0]!.setAttribute('id', '99')
    chart.parentNode!.appendChild(copied)
    proposal.write(part)
    const latest = new OfficePackage(base)
    const relation = inspectPartRelationships(latest, part).find(value => value.type.endsWith('/chart'))!
    const values = latest.xml(relation.part!).getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'v')
    values[0]!.textContent = 'Other series'
    latest.write(relation.part!)
    const newReference = proposal.save(), changedChart = latest.save()
    expect(() => mergeOfficeContent(base, { format: 'pptx', bytes: newReference, changedParts: [part], diagnostics: [] }, changedChart))
      .toThrow(`${part}#${relation.id}。 新引用的依赖部件已修改：${relation.part}`)
    expect(() => mergeOfficeContent(base, { format: 'pptx', bytes: changedChart, changedParts: [relation.part!], diagnostics: [] }, newReference))
      .toThrow(`${part}#${relation.id}。 新引用的依赖部件已修改：${relation.part}`)
  })

  it('reallocates Excel shared style indices while preserving both independently formatted cells', async () => {
    const base = (await applyOfficeContent(undefined, { operation: 'create', format: 'xlsx',
      sheets: [{ name: 'Sheet1', rows: [[1, 2]] }] })).bytes
    const proposed = { format: 'xlsx' as const, target: { sheet: 'Sheet1', cell: 'A1' }, style: { numberFormat: '0.00' } }
    const latest = applyOfficeObjectEdit(base, { format: 'xlsx', target: { sheet: 'Sheet1', cell: 'B1' }, style: { numberFormat: '0.000' } })
    const merged = mergeOfficeContent(base, applyOfficeObjectEdit(base, proposed), latest.bytes, proposed)
    expect(inspectOfficeContent(merged.bytes, 'xlsx')).toMatchObject({ sheets: [{ cells: [
      { cell: 'A1', value: 1, display: '1.00' }, { cell: 'B1', value: 2, display: '2.000' },
    ] }] })
    expect(mergeOfficeContent(base, applyOfficeObjectEdit(base, proposed), merged.bytes, proposed).changedParts).toEqual([])
  })
})
