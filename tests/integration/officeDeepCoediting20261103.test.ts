// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { OfficePackage, descendants, NS } from '../../src/main/workbench/office/officePackage'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-deep-')); roots.push(directory)
  const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
  const filename = path.join(workspace, 'complex.pptx'), original = await complexPptxFixture(); await fs.writeFile(filename, original)
  const owner = path.join(directory, 'owner'), host = new DocumentHostService(owner)
  await host.files.registerRoot(workspace)
  const office = new OfficeFileService(host), binding = await host.artifacts.bind(filename)
  return { directory, original, host, office, binding, owner }
}
const ppt = (bytes: Uint8Array) => {
  const result = inspectOfficeContent(bytes, 'pptx')
  if (result.format !== 'pptx') throw new Error('wrong format')
  return result
}
describe('controlled deeper PPT editing through the existing transaction owner', () => {
  it('changes a chart point in both cache and embedded workbook, preserves animation and unrelated parts, then cold undoes', async () => {
    const f = await setup(), before = new OfficePackage(f.original), slide = ppt(f.original).slides[0]
    const shape = slide.shapes.find(object => object.chart)!, chart = shape.chart!
    const saved = await f.office.edit(f.binding, { format: 'pptx', operation: 'edit', edits: [{
      type: 'chartValue', slide: 0, shapeId: shape.shapeId, part: slide.part, partVersion: slide.partVersion,
      chartPart: chart.part, chartVersion: chart.partVersion, series: chart.series[0].index, point: 1, value: 97,
    }] }, { actor: 'ai', operationId: 'chart-source-and-cache' })
    const bytes = await f.host.artifacts.read(saved.binding), after = new OfficePackage(bytes)
    expect(ppt(bytes).slides[0].shapes.find(object => object.chart)?.chart?.series[0].values[1].value).toBe(97)
    const book = inspectOfficeContent(after.parts[chart.embeddedWorkbook!], 'xlsx')
    expect(book.format === 'xlsx' && book.sheets[0].cells.some(cell => cell.value === 97)).toBe(true)
    for (const [name, value] of Object.entries(before.parts)) {
      if (name !== chart.part && name !== chart.embeddedWorkbook) expect(after.parts[name], name).toEqual(value)
    }
    const coldHost = new DocumentHostService(f.owner), cold = new OfficeFileService(coldHost)
    const reopened = await coldHost.artifacts.bind(saved.binding.path)
    expect((await cold.history(reopened)).entries[0].actor).toBe('ai')
    const undone = await cold.moveHistory(reopened, 'undo')
    expect(await coldHost.artifacts.read(undone.binding)).toEqual(f.original)
    const redone = await cold.moveHistory(undone.binding, 'redo')
    expect(await coldHost.artifacts.read(redone.binding)).toEqual(bytes)
  })
  it('changes only a real animation behavior duration and refuses container timing or stale identities', async () => {
    const f = await setup(), slide = ppt(f.original).slides[0]
    const target = { type: 'animationTiming' as const, slide: 0, part: slide.part, partVersion: slide.partVersion, timingId: '2', durationMs: 1250 }
    const saved = await f.office.edit(f.binding, { format: 'pptx', operation: 'edit', edits: [target] }, { actor: 'ai' })
    const afterBytes = await f.host.artifacts.read(saved.binding), after = new OfficePackage(afterBytes), before = new OfficePackage(f.original)
    expect(ppt(afterBytes).slides[0].animations?.find(node => node.id === '2')?.duration).toBe('1250')
    for (const [name, value] of Object.entries(before.parts)) if (name !== slide.part) expect(after.parts[name], name).toEqual(value)
    const timing = descendants(after.xml(slide.part), NS.slide, 'cTn').find(node => node.getAttribute('id') === '2')!
    timing.setAttribute('dur', '500'); after.write(slide.part)
    expect(ppt(after.save()).slides[0].animations).toEqual(slide.animations)
    const latest = ppt(afterBytes).slides[0]
    await expect(f.office.edit(saved.binding, { format: 'pptx', operation: 'edit', edits: [{ ...target, partVersion: latest.partVersion, timingId: '1' }] })).rejects.toThrow('动画目标')
    await expect(f.office.edit(saved.binding, { format: 'pptx', operation: 'edit', edits: [target] })).rejects.toThrow('内容已改变')
    expect(await f.host.artifacts.read(saved.binding)).toEqual(afterBytes)
  })
  it('refuses broken candidates before physical commit and retains the original history', async () => {
    const f = await setup(), candidate = new OfficePackage(f.original)
    candidate.remove('customXml/opaque.bin')
    await expect(f.office.commitCandidate(f.binding, candidate.save(), 'pptx', {
      actor: 'human', expectedVersion: f.binding.fileVersion,
    })).rejects.toThrow('保全原件结构')
    expect(await f.host.artifacts.read(f.binding)).toEqual(f.original)
    expect((await f.office.history(f.binding)).undoDepth).toBe(0)
  })
})
