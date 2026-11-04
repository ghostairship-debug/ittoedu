// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { FileArtifactHistory } from '../../src/main/workbench/FileArtifactHistory'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
const text = (bytes: Uint8Array) => {
  const inspection = inspectOfficeContent(bytes, 'docx')
  if (inspection.format !== 'docx') throw new Error('expected Word document')
  return inspection.paragraphs.map(p => p.text).join('\n')
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-draft-relocation-'))
  roots.push(directory)
  const workspace = path.join(directory, 'workspace'), owner = path.join(directory, 'owner')
  await fs.mkdir(workspace)
  const source = path.join(workspace, 'source.docx'), target = path.join(workspace, 'renamed.docx')
  const original = (await applyOfficeContent(undefined, { format: 'docx', operation: 'create',
    blocks: [{ type: 'paragraph', text: 'Saved original' }] })).bytes
  await fs.writeFile(source, original)
  const host = new DocumentHostService(owner), office = new OfficeFileService(host)
  const opened = await office.bindWorking(source, true)
  await office.edit(opened, { format: 'docx', operation: 'edit',
    edits: [{ type: 'paragraph', index: 0, text: 'Unsaved human draft' }] }, { actor: 'human' })
  await host.artifacts.preserveOfficeDrafts()
  return { source, target, original, workspace, owner, host, office }
}
async function rename(host: DocumentHostService, workspace: string) {
  const root = await host.files.registerRoot(workspace)
  const entries = await host.files.listChildren({ workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const source = entries.entries.find(entry => entry.name === 'source.docx' && entry.status === 'accessible')
  if (!source || source.status !== 'accessible') throw new Error('missing source')
  const result = await host.files.rename({ operationId: 'rename-recoverable-office', workspaceId: root.workspaceId,
    sourceEntryId: source.entryId, name: 'renamed.docx' })
  expect(result.status).toBe('success')
}

it('restores an unopened Office draft after a new process renames its file', async () => {
  const f = await fixture()
  await f.host.artifacts.releaseOfficeDrafts(false, true)
  const coldHost = new DocumentHostService(f.owner), cold = new OfficeFileService(coldHost)
  await rename(coldHost, f.workspace)
  const recovered = await cold.bindWorking(f.target, true)
  expect(text(await cold.readWorking(recovered))).toBe('Unsaved human draft')
  expect(await fs.readFile(f.target)).toEqual(Buffer.from(f.original))
  expect(cold.isDraftDirty(f.target)).toBe(true)
  expect((await cold.history(recovered)).entries.map(entry => entry.actor)).toEqual(['human'])
  await cold.saveWorking(recovered)
  const reopened = new OfficeFileService(new DocumentHostService(f.owner))
  const saved = await reopened.bindWorking(f.target, true)
  expect(text(await reopened.readWorking(saved))).toBe('Unsaved human draft')
  const undone = await reopened.moveHistory(saved, 'undo')
  expect(text(await reopened.readWorking(undone.binding))).toBe('Saved original')
  expect(await new FileArtifactHistory(path.join(f.owner, 'artifact-history')).readOfficeDraft(f.source)).toBeUndefined()
}, 20_000)

it('removes the relocated recovery record when an open draft is discarded', async () => {
  const f = await fixture()
  await rename(f.host, f.workspace)
  const rebound = await f.office.bindWorking(f.target)
  expect(text(await f.office.readWorking(rebound))).toBe('Unsaved human draft')
  await f.office.closeWorking(f.target, true)
  const history = new FileArtifactHistory(path.join(f.owner, 'artifact-history'))
  expect(await history.readOfficeDraft(f.source)).toBeUndefined()
  expect(await history.readOfficeDraft(f.target)).toBeUndefined()
  const cold = new OfficeFileService(new DocumentHostService(f.owner))
  expect(text(await cold.readWorking(await cold.bindWorking(f.target, true)))).toBe('Saved original')
}, 20_000)

