// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import type { AgentFileContext } from '../../src/core/tools/AgentFileTools'
import { freezeTaskInputs, type TaskInputFreezePorts } from '../../src/main/workbench/delegation/freezeTaskInputs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })))
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'guoling-directory-sources-'))
  roots.push(root)
  const workspaceRoot = path.join(root, 'workspace'), materials = path.join(root, '英语素材2')
  const directory = path.join(materials, 'unit1'), pictures = path.join(directory, 'pictures')
  await fs.mkdir(workspaceRoot)
  await fs.mkdir(pictures, { recursive: true })
  const markdown = path.join(materials, 'Unit 1 Section A 2a-2e.md')
  await fs.writeFile(markdown, '# Reading\n![figure](./unit1/pictures/diagram.png)')
  await fs.writeFile(path.join(directory, 'notes.md'), '# Saved notes')
  await fs.writeFile(path.join(pictures, 'diagram.png'), new Uint8Array([0, 0xff, 1, 2, 3]))
  const host = new DocumentHostService(path.join(root, 'documents')), files = new AgentFileService(host)
  const context: AgentFileContext = { runId: 'parent', workspaceRoot, permission: 'full' }
  const ports: TaskInputFreezePorts = {
    assertActive() {}, isMaterial: () => false, material: async () => { throw new Error('unused material') },
    authorize: source => files.authorizeTaskInput(context, source),
    directory: (source, signal) => files.taskInputDirectory(context, source, signal),
    opened: filename => host.readOpenedTaskInput(filename),
    disk: source => files.readAuthorizedFile(context, source),
  }
  return { root, directory, markdown, host, files, context, ports }
}

it('freezes an external MD plus an ordinary resource directory with original names and binary bytes', async () => {
  const h = await fixture()
  const frozen = await freezeTaskInputs([h.markdown, h.directory], h.ports)
  expect(frozen.map(source => source.name)).toEqual([
    'Unit 1 Section A 2a-2e.md', 'unit1/notes.md', 'unit1/pictures/diagram.png',
  ])
  expect(Buffer.from(frozen[0].bytes).toString('utf8')).toContain('./unit1/pictures/diagram.png')
  expect(frozen[2].bytes).toEqual(new Uint8Array([0, 0xff, 1, 2, 3]))
  expect(frozen[2].source).toBe(path.join(h.directory, 'pictures', 'diagram.png'))
  expect(await fs.readFile(h.markdown, 'utf8')).toContain('./unit1/pictures/diagram.png')
  // The single-file owner still rejects directories; the freeze owner routes them correctly.
  await expect(h.host.artifacts.bind(h.directory)).rejects.toThrow('文件位置已改变')
})

it('uses a current unsaved member through the existing document owner and preserves disk-version selection', async () => {
  const h = await fixture(), filename = path.join(h.directory, 'notes.md')
  const current = await h.host.registry.create(new MarkdownDriver().load(new TextEncoder().encode('# Unsaved current notes')), 'notes.md')
  const ports = { ...h.ports, opened: async (selected: string) => selected === filename ? current.read() : undefined }
  const captured = await freezeTaskInputs([h.directory], ports)
  const note = captured.find(source => source.name === 'unit1/notes.md')!
  expect(Buffer.from(note.bytes).toString('utf8')).toBe('# Unsaved current notes')
  expect(note.version).toMatch(/^document:/)
  const disk = await freezeTaskInputs([h.directory], ports, { sourceVersion: 'disk' })
  expect(Buffer.from(disk.find(source => source.name === 'unit1/notes.md')!.bytes).toString('utf8')).toBe('# Saved notes')
  expect(await fs.readFile(filename, 'utf8')).toBe('# Saved notes')
})

it('does not expand a workspace grant to an external directory', async () => {
  const h = await fixture()
  h.context.permission = 'workspace'
  await expect(freezeTaskInputs([h.directory], h.ports)).rejects.toThrow('不允许')
})

it('rejects a directory junction or symlink even when its target is readable under full permission', async () => {
  const h = await fixture(), outside = path.join(h.root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'private.txt'), 'must not enter the snapshot')
  await fs.symlink(outside, path.join(h.directory, 'linked'), 'junction')
  await expect(freezeTaskInputs([h.directory], h.ports)).rejects.toThrow(/链接|越界/)
})

it('rejects changed directory membership after reading and honors cancellation without returning a partial capture', async () => {
  const h = await fixture()
  let changed = false
  await expect(freezeTaskInputs([h.directory], { ...h.ports, disk: async source => {
    const file = await h.ports.disk(source)
    if (!changed) { changed = true; await fs.writeFile(path.join(h.directory, 'late.txt'), 'late member') }
    return file
  } })).rejects.toThrow('冻结期间改变')
  const controller = new AbortController()
  controller.abort()
  await expect(freezeTaskInputs([h.directory], h.ports, { signal: controller.signal })).rejects.toBeDefined()
})
