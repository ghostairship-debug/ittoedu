// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'

const tableCount = (bytes: Uint8Array) => {
  const content = inspectOfficeContent(bytes, 'pptx')
  if (content.format !== 'pptx') throw new Error('Expected PPTX')
  return content.slides[0].shapes.filter(shape => shape.kind === 'table').length
}

it('keeps copied table redo through explicit saves and a cold reopen', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-redo-save-'))
  try {
    const workspace = path.join(root, 'workspace'), owner = path.join(root, 'owner')
    await fs.mkdir(workspace)
    const filename = path.join(workspace, 'tables.pptx'), deck = new PptxGenJS()
    deck.addSlide().addTable([[{ text: 'one' }, { text: 'two' }], [{ text: 'three' }, { text: 'four' }]], { x: 1, y: 1, w: 4, h: 2 })
    const source = await deck.write({ outputType: 'uint8array' }) as Uint8Array
    await fs.writeFile(filename, source)
    const host = new DocumentHostService(owner), office = new OfficeFileService(host)
    await host.files.registerRoot(workspace)
    let binding = await office.bindWorking(filename, true)
    const pkg = new OfficePackage(source), part = 'ppt/slides/slide1.xml', xml = pkg.xml(part)
    const table = descendants(xml, NS.slide, 'graphicFrame')[0], copy = table.cloneNode(true) as Element
    descendants(copy, NS.slide, 'cNvPr')[0].setAttribute('id', '200')
    table.parentNode!.appendChild(copy); pkg.write(part)
    binding = (await office.commitCandidate(binding, pkg.save(), 'pptx', { expectedVersion: binding.fileVersion })).binding
    expect(tableCount(await office.readWorking(binding))).toBe(2)
    binding = await office.saveWorking(binding)
    expect(tableCount(await fs.readFile(filename))).toBe(2)
    binding = (await office.moveHistory(binding, 'undo')).binding
    expect(tableCount(await office.readWorking(binding))).toBe(1)
    binding = await office.saveWorking(binding)
    expect(tableCount(await fs.readFile(filename))).toBe(1)
    expect((await office.history(binding)).redoDepth).toBe(1)
    binding = (await office.moveHistory(binding, 'redo')).binding
    expect(tableCount(await office.readWorking(binding))).toBe(2)
    binding = await office.saveWorking(binding)
    expect(tableCount(await fs.readFile(filename))).toBe(2)
    const cold = new OfficeFileService(new DocumentHostService(owner))
    expect(tableCount(await cold.readWorking(await cold.bindWorking(filename, true)))).toBe(2)
  } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
}, 20_000)
