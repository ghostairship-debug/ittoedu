// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { saveFileArtifactAs } from '../../src/main/workbench/fileArtifactSaveAs'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import type { OfficeContentRequest } from '../../src/shared/workbench/officeFiles'
import type { FileArtifactSaveAsRequest } from '../../src/shared/workbench/fileArtifactSaveAs'

const desktop = vi.hoisted(() => ({
  host: undefined as DocumentHostService | undefined,
  showSaveDialog: vi.fn<() => Promise<{ canceled: boolean; filePath?: string }>>(),
}))
vi.mock('electron', () => ({ dialog: { showSaveDialog: desktop.showSaveDialog }, app: {}, net: {} }))
vi.mock('../../src/main/workbench/documentHost', () => ({ documentHost: () => desktop.host }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ assertAuthorizedWorkspacePath: (filename: string) => fs.realpath(filename) }))
const roots: string[] = []
afterEach(async () => {
  desktop.showSaveDialog.mockReset()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function workspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-save-as-'))
  roots.push(directory)
  desktop.host = new DocumentHostService(path.join(directory, 'owner'))
  return { directory: await fs.realpath(directory), host: desktop.host }
}

it.each(['docx', 'xlsx', 'pptx'] as const)('copies the current %s draft and keeps subsequent saves on the new path', async format => {
  const { directory, host } = await workspace()
  const source = path.join(directory, `source.${format}`), target = path.join(directory, `copy.${format}`)
  const initial: OfficeContentRequest = format === 'docx' ? { format, operation: 'create', blocks: [{ type: 'paragraph', text: 'Original' }] }
    : format === 'xlsx' ? { format, operation: 'create', sheets: [{ name: 'Sheet1', rows: [['Original']] }] }
      : { format, operation: 'create', slides: [{ title: 'Original' }] }
  const edit = (text: string): Extract<OfficeContentRequest, { operation: 'edit' }> => format === 'docx' ? { format, operation: 'edit', edits: [{ type: 'paragraph', index: 0, text }] }
    : format === 'xlsx' ? { format, operation: 'edit', edits: [{ sheet: 'Sheet1', cell: 'A1', value: text }] }
      : { format, operation: 'edit', edits: [{ slide: 0, shape: 'title', text }] }
  await fs.writeFile(source, (await applyOfficeContent(undefined, initial)).bytes)
  const office = new OfficeFileService(host)
  const original = await office.bindWorking(source, true)
  const draft = await office.edit(original, edit('Unsaved draft'))
  const request: FileArtifactSaveAsRequest = { kind: 'office', binding: draft.binding, openPaths: [source] }
  desktop.showSaveDialog.mockResolvedValueOnce({ canceled: true })
  await expect(saveFileArtifactAs({} as never, request)).resolves.toBeNull()
  expect(office.isDraftDirty(source)).toBe(true)
  desktop.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
  const copy = await saveFileArtifactAs({} as never, request)
  if (copy?.kind !== 'office') throw new Error('expected Office save receipt')
  expect(copy.snapshot).toMatchObject({ binding: { path: target }, draftDirty: false })
  expect(JSON.stringify(inspectOfficeContent(await fs.readFile(target), format))).toContain('Unsaved draft')
  expect(JSON.stringify(inspectOfficeContent(await fs.readFile(source), format))).toContain('Original')
  const continued = await office.edit(copy.snapshot.binding, edit('Continued in copy'))
  await office.saveWorking(continued.binding)
  expect(JSON.stringify(inspectOfficeContent(await fs.readFile(target), format))).toContain('Continued in copy')
  expect(JSON.stringify(inspectOfficeContent(await fs.readFile(source), format))).toContain('Original')
}, 20_000)

it('copies an edited image at native size while leaving its source untouched', async () => {
  const { directory, host } = await workspace()
  const source = path.join(directory, 'source.png'), target = path.join(directory, 'copy.png')
  await fs.writeFile(source, await sharp({ create: { width: 80, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer())
  const binding = await host.artifacts.bind(source)
  desktop.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
  await expect(saveFileArtifactAs({} as never, {
    kind: 'media', binding, openPaths: [source], operations: [{ type: 'image.rotate', degrees: 90 }],
  })).resolves.toMatchObject({ kind: 'media', snapshot: { binding: { path: target }, content: { width: 40, height: 80 } } })
  await expect(sharp(source).metadata()).resolves.toMatchObject({ width: 80, height: 40 })
})
