// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-host-'))
  directories.push(directory)
  const recovery = path.join(directory, 'recovery')
  return { directory, recovery, host: new DocumentHostService(recovery) }
}
async function create(host: DocumentHostService) {
  return await host.operate({ type: 'create', suggestedName: '未保存.md', model: { kind: 'markdown', source: '', resources: { assets: {}, components: {} } } }) as DocumentSnapshot
}
async function edit(host: DocumentHostService, snapshot: DocumentSnapshot, operationId: string, source: string) {
  return host.operate({ type: 'dispatch', operation: { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } } } })
}

it('G20 automatic starter is pristine, reuses one writer and becomes recoverable after a real edit', async () => {
  const { host, recovery } = await setup()
  const [a, b] = await Promise.all([host.bootstrapCourse(), host.bootstrapCourse()])
  expect(a.documentId).toBe(b.documentId)
  expect(a).toMatchObject({ dirty: false, binding: { kind: 'untitled' }, undoDepth: 0 })
  expect(await host.operate({ type: 'recoverable' })).toEqual([])
  if (a.model.kind !== 'course-v9') throw new Error('starter kind')
  expect(await host.operate({ type: 'dispatch', operation: { documentId: a.documentId, epoch: a.epoch,
    operationId: 'edit-starter', baseRevision: a.revision, actor: 'human',
    mutation: { type: 'command', command: { type: 'course.replace', project: { ...a.model.project, title: '有内容的课件' } } },
  } })).toMatchObject({ status: 'applied' })
  expect(await host.bootstrapCourse()).toMatchObject({ documentId: a.documentId, dirty: true, undoDepth: 1 })
  expect(await host.operate({ type: 'recoverable' })).toEqual([])
  expect(await new DocumentHostService(recovery).operate({ type: 'recoverable' })).toMatchObject([{ documentId: a.documentId, dirty: true }])
  const created = await host.operate({ type: 'create', model: a.model, suggestedName: '用户新建.h5lesson' }) as DocumentSnapshot
  expect(created.dirty).toBe(true)
  await expect(host.operate({ type: 'create', model: a.model, suggestedName: '不可假保存.h5lesson', pristine: true })).rejects.toThrow()
})

it('G20 real FileService bridge preserves source, conflicts, Save As, reopen and explicit discard', async () => {
  const { host, directory, recovery } = await setup()
  const created = await create(host)
  expect(await edit(host, created, 'human-1', '\ufeff# 中文 😀\r\n')).toMatchObject({ status: 'applied' })
  const filename = path.join(directory, '原稿.md')
  const saved = await host.operate({ type: 'save', documentId: created.documentId, path: filename }) as DocumentSnapshot
  expect(saved.dirty).toBe(false)
  expect(await fs.readFile(filename, 'utf8')).toBe('\ufeff# 中文 😀\r\n')
  expect((await host.open(filename)).documentId).toBe(created.documentId)
  await edit(host, saved, 'human-2', '# 内存新稿\n')
  await fs.writeFile(filename, '# 外部修改\n')
  await expect(host.operate({ type: 'save', documentId: created.documentId })).rejects.toThrow('已改变')
  expect(await fs.readFile(filename, 'utf8')).toBe('# 外部修改\n')
  const copy = path.join(directory, '另存.md')
  await host.operate({ type: 'save', documentId: created.documentId, path: copy })
  expect(await fs.readFile(copy, 'utf8')).toBe('# 内存新稿\n')
  expect(await fs.readFile(filename, 'utf8')).toBe('# 外部修改\n')
  await host.operate({ type: 'close', documentId: created.documentId })
  const reopened = await host.open(copy)
  expect(reopened.model).toMatchObject({ kind: 'markdown', source: '# 内存新稿\n' })
  await edit(host, reopened, 'discard-me', 'deliberately discarded')
  await host.operate({ type: 'close', documentId: reopened.documentId, discardDirty: true })
  expect(await new DocumentHostService(recovery).operate({ type: 'recoverable' })).toEqual([])
  expect(await fs.readFile(copy, 'utf8')).toBe('# 内存新稿\n')
})

it('G20 app restart restores committed draft and operation receipt without rerunning an operation', async () => {
  const { host, recovery } = await setup()
  const created = await create(host)
  const receipt = await edit(host, created, 'known-op', '未保存但已持久化')
  const restarted = new DocumentHostService(recovery)
  expect(await restarted.operate({ type: 'recoverable' })).toMatchObject([{ documentId: created.documentId, dirty: true, revision: 1 }])
  const restored = await restarted.operate({ type: 'restore', documentId: created.documentId }) as DocumentSnapshot
  expect(restored.epoch).not.toBe(created.epoch)
  expect(restored.model).toMatchObject({ source: '未保存但已持久化' })
  expect(restored.undoDepth).toBe(1)
  expect(await restarted.operate({ type: 'lookup', documentId: created.documentId, operationId: 'known-op' })).toEqual(receipt)
  expect(await edit(restarted, created, 'late-old-window', 'must not replace')).toMatchObject({ status: 'conflict', code: 'stale-epoch' })
  expect((await restarted.operate({ type: 'read', documentId: created.documentId }) as DocumentSnapshot).model).toMatchObject({ source: '未保存但已持久化' })
})

it('G20 external file reconciliation preserves history, validates both versions and never recreates a moved file', async () => {
  const { host, directory } = await setup()
  const filename = path.join(directory, 'external.md')
  await fs.writeFile(filename, 'base\n')
  const initial = await host.open(filename)
  await fs.writeFile(filename, 'external\n')
  const observation = await host.observeFile(initial.documentId)
  const reconciled = await host.reconcileFile({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })
  expect(reconciled).toMatchObject({ documentId: initial.documentId, dirty: false, revision: 1, undoDepth: 1, model: { source: 'external\n' } })
  await edit(host, reconciled, 'local-edit', 'local\n')
  await expect(host.reconcileFile({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: reconciled.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })).rejects.toThrow('文档已改变')
  const current = await host.internalAPI.read(initial.documentId)
  await fs.writeFile(filename, 'external again\n')
  await expect(host.reconcileFile({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: current.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'local' })).rejects.toThrow('磁盘文件再次改变')
  const observedAgain = await host.observeFile(initial.documentId)
  const merged = await host.reconcileFile({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: current.revision, bindingVersion: observedAgain.bindingVersion, version: observedAgain.version, choice: 'local', source: 'local + external\n' })
  expect(merged).toMatchObject({ dirty: true, undoDepth: 3, model: { source: 'local + external\n' } })
  await host.saveToPath(initial.documentId)
  expect(await fs.readFile(filename, 'utf8')).toBe('local + external\n')
  await fs.rename(filename, path.join(directory, 'moved.md'))
  const moved = await host.observeFile(initial.documentId)
  expect(moved).toMatchObject({ version: null, model: null })
  await expect(host.reconcileFile({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: merged.revision, bindingVersion: moved.bindingVersion, version: null, choice: 'local' })).rejects.toThrow('另存')
  await expect(host.saveToPath(initial.documentId)).rejects.toThrow('已改变')
  await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('G20 overwrite permission is only supplied by the trusted native dialog path', async () => {
  const { host, directory } = await setup()
  const created = await create(host)
  await edit(host, created, 'text', 'new')
  const target = path.join(directory, 'existing.md')
  await fs.writeFile(target, 'old')
  await expect(host.operate({ type: 'save', documentId: created.documentId, path: target, overwriteConfirmed: true })).rejects.toThrow()
  await expect(host.saveToPath(created.documentId, target)).rejects.toThrow('已存在')
  expect(await fs.readFile(target, 'utf8')).toBe('old')
  const saved = await host.saveToPath(created.documentId, target, true)
  expect(saved).toMatchObject({ dirty: false, binding: { kind: 'file', path: target } })
  expect(await fs.readFile(target, 'utf8')).toBe('new')
})
