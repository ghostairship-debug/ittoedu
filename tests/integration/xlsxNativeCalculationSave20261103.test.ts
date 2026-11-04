// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

it('shows and saves recalculated native Excel edits through the actual draft owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xlsx-native-calc-'))
  try {
    const workspace = path.join(root, 'workspace'), owner = path.join(root, 'owner')
    await fs.mkdir(workspace)
    const file = path.join(workspace, 'book.xlsx')
    const initial = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
      { name: 'Sheet1', rows: [[2, { formula: 'A1*2' }]] },
    ] })
    await fs.writeFile(file, initial.bytes)
    const host = new DocumentHostService(owner)
    await host.files.registerRoot(workspace)
    const service = new OfficeFileService(host), binding = await service.bindWorking(file, true)
    const result = await service.editObject(binding, { format: 'xlsx', target: { sheet: 'Sheet1', cell: 'A1' },
      native: { path: [], xml: '<c xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" r="A1"><v>9</v></c>' } }, { actor: 'ai' })
    expect(result.status).toBe('draft')
    expect(await fs.readFile(file)).toEqual(Buffer.from(initial.bytes))
    const draft = await service.inspect(result.binding, 'xlsx')
    if (draft.inspection.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(draft.inspection.sheets[0].cells).toMatchObject([{ value: 9 }, { value: 18, formula: 'A1*2' }])
    await service.saveWorking(result.binding)
    const cold = new OfficeFileService(new DocumentHostService(owner)), reopened = await cold.bindWorking(file, true)
    const content = inspectOfficeContent(await cold.readWorking(reopened), 'xlsx')
    if (content.format !== 'xlsx') throw new Error('Expected XLSX')
    expect(content.sheets[0].cells).toMatchObject([{ value: 9 }, { value: 18, formula: 'A1*2' }])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}, 20_000)
