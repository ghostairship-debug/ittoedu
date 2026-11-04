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
  it('undoes one AI instruction across draft and save boundaries without absorbing human edits', async () => {
    const f = await setup(), filename = f.binding.path
    const ai = { actor: 'ai' as const, historyGroup: 'instruction-1' }
    let binding = await f.office.bindWorking(filename, true)
    const editTiming = async (durationMs: number, context: typeof ai | { actor: 'human' }) => {
      const slide = ppt(await f.office.readWorking(binding)).slides[0]
      const result = await f.office.edit(binding, { operation: 'edit', format: 'pptx', edits: [
        { type: 'animationTiming', slide: 0, part: slide.part, partVersion: slide.partVersion, timingId: '2', durationMs },
      ] }, context)
      binding = result.binding
    }
    const timing = (bytes: Uint8Array) => ppt(bytes).slides[0].animations?.find(item => item.id === '2')?.duration
    const title = (bytes: Uint8Array) => ppt(bytes).slides[0].shapes.find(item => item.name === 'title')?.text
    await editTiming(1100, ai)
    binding = await f.office.saveWorking(binding)
    const slide = ppt(await f.office.readWorking(binding)).slides[0], shape = slide.shapes.find(item => item.name === 'title')!
    binding = (await f.office.editObject(binding, { format: 'pptx',
      target: { slide: 0, part: slide.part, partVersion: slide.partVersion, shapeId: shape.shapeId },
      edit: { path: ['p:txBody', 'a:p', 'a:r', 'a:t'].map(name => ({ name, index: 0 })),
        xml: `<a:t xmlns:a="${NS.drawing}">Instruction title</a:t>` },
    }, ai)).binding
    await editTiming(1300, ai)
    expect((await f.office.history(binding)).undoDepth).toBe(1)
    const undone = await f.office.moveHistory(binding, 'undo')
    expect(timing(await f.office.readWorking(undone.binding))).toBe(timing(f.original))
    expect(title(await f.office.readWorking(undone.binding))).toBe(title(f.original))
    expect(timing(await fs.readFile(filename))).toBe('1100')
    binding = (await f.office.moveHistory(undone.binding, 'redo')).binding
    expect(timing(await f.office.readWorking(binding))).toBe('1300')
    expect(title(await f.office.readWorking(binding))).toBe('Instruction title')
    await editTiming(1400, { actor: 'human' })
    await editTiming(1500, ai)
    expect((await f.office.history(binding)).entries.map(entry => entry.actor)).toEqual(['ai', 'human', 'ai'])
    await f.office.saveWorking(binding)
    const reopened = new OfficeFileService(new DocumentHostService(f.owner))
    const saved = await reopened.bindWorking(filename, true)
    const firstUndo = await reopened.moveHistory(saved, 'undo')
    expect(timing(await reopened.readWorking(firstUndo.binding))).toBe('1400')
    const secondUndo = await reopened.moveHistory(firstUndo.binding, 'undo')
    expect(timing(await reopened.readWorking(secondUndo.binding))).toBe('1300')
    const thirdUndo = await reopened.moveHistory(secondUndo.binding, 'undo')
    expect(timing(await reopened.readWorking(thirdUndo.binding))).toBe(timing(f.original))
    expect(timing(await fs.readFile(filename))).toBe('1500')
  }, 20_000)
  it('retains the new redo branch when saved from an earlier persisted revision', async () => {
    const f = await setup(), filename = f.binding.path
    let binding = await f.office.bindWorking(filename, true)
    const editTiming = async (durationMs: number) => {
      const slide = ppt(await f.office.readWorking(binding)).slides[0]
      const result = await f.office.edit(binding, { operation: 'edit', format: 'pptx', edits: [
        { type: 'animationTiming', slide: 0, part: slide.part, partVersion: slide.partVersion, timingId: '2', durationMs },
      ] }, { actor: 'human' })
      binding = result.binding
    }
    const timing = (bytes: Uint8Array) => ppt(bytes).slides[0].animations?.find(item => item.id === '2')?.duration
    await editTiming(1100)
    await editTiming(1200)
    binding = await f.office.saveWorking(binding)
    binding = (await f.office.moveHistory(binding, 'undo')).binding
    await editTiming(1300)
    binding = (await f.office.moveHistory(binding, 'undo')).binding
    binding = (await f.office.moveHistory(binding, 'undo')).binding
    expect(timing(await f.office.readWorking(binding))).toBe(timing(f.original))
    await f.office.saveWorking(binding)
    const reopened = new OfficeFileService(new DocumentHostService(f.owner))
    const saved = await reopened.bindWorking(filename, true)
    const firstRedo = await reopened.moveHistory(saved, 'redo')
    expect(timing(await reopened.readWorking(firstRedo.binding))).toBe('1100')
    const secondRedo = await reopened.moveHistory(firstRedo.binding, 'redo')
    expect(timing(await reopened.readWorking(secondRedo.binding))).toBe('1300')
    expect((await reopened.history(secondRedo.binding)).redoDepth).toBe(0)
  }, 20_000)
  it('shares a manual-save draft with AI, persists both history entries in one save, and stages cold undo', async () => {
    const f = await setup(), filename = f.binding.path
    const draft = await f.office.bindWorking(filename, true)
    const slide = ppt(f.original).slides[0]
    const timing = { type: 'animationTiming' as const, slide: 0, part: slide.part, partVersion: slide.partVersion, timingId: '2', durationMs: 1250 }
    const human = await f.office.edit(draft, { format: 'pptx', operation: 'edit', edits: [timing] }, { actor: 'human' })
    const agent = new OfficeFileService(f.host)
    const seen = await agent.inspect(await agent.bindWorking(filename), 'pptx')
    expect(seen.binding).toEqual(human.binding)
    if (seen.inspection.format !== 'pptx') throw new Error('wrong format')
    expect(seen.inspection.slides[0].animations?.find(item => item.id === '2')?.duration).toBe('1250')
    const ai = await agent.edit(seen.binding, { format: 'pptx', operation: 'edit', edits: [
      { ...timing, partVersion: seen.inspection.slides[0].partVersion, durationMs: 1800 },
    ] }, { actor: 'ai', expectedVersion: seen.binding.fileVersion })
    expect(ai.status).toBe('draft')
    expect(await fs.readFile(filename)).toEqual(Buffer.from(f.original))
    await expect(agent.edit(seen.binding, { format: 'pptx', operation: 'edit', edits: [
      { ...timing, partVersion: seen.inspection.slides[0].partVersion, durationMs: 1600 },
    ] }, { actor: 'ai', observedBytes: seen.observedBytes })).rejects.toMatchObject({ code: 'office-merge-conflict',
      location: expect.stringContaining('/@dur') })
    await f.host.artifacts.preserveOfficeDrafts()
    const restored = new OfficeFileService(new DocumentHostService(f.owner))
    const recovery = await restored.bindWorking(filename, true)
    expect(restored.isDraftDirty(filename)).toBe(true)
    expect((await restored.history(recovery)).entries.map(item => item.actor)).toEqual(['human', 'ai'])
    const saved = await restored.saveWorking(recovery)
    expect(saved).toEqual(recovery)
    expect(ppt(await fs.readFile(filename)).slides[0].animations?.find(item => item.id === '2')?.duration).toBe('1800')
    const cold = new OfficeFileService(new DocumentHostService(f.owner))
    const reopened = await cold.bindWorking(filename, true)
    expect((await cold.history(reopened)).entries.map(item => item.actor)).toEqual(['human', 'ai'])
    const undone = await cold.moveHistory(reopened, 'undo')
    expect(ppt(await cold.readWorking(undone.binding)).slides[0].animations?.find(item => item.id === '2')?.duration).toBe('1250')
    expect(ppt(await fs.readFile(filename)).slides[0].animations?.find(item => item.id === '2')?.duration).toBe('1800')
    const savedUndo = await cold.saveWorking(undone.binding)
    expect((await cold.history(savedUndo)).redoDepth).toBe(1)
    expect(ppt(await fs.readFile(filename)).slides[0].animations?.find(item => item.id === '2')?.duration).toBe('1250')
    await cold.closeWorking(filename, false)
    const physical = await cold.bindWorking(filename)
    expect(physical.fileVersion).not.toBe(savedUndo.fileVersion)
    await expect(cold.edit(physical, { format: 'pptx', operation: 'edit', edits: [timing] }, {
      expectedVersion: savedUndo.fileVersion,
    })).rejects.toThrow('文件版本已改变')
  }, 15_000)
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
