// @vitest-environment node
import { fork, type ForkOptions } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { createDocumentJournal, readDocumentFileVersion } from '../../src/main/workbench/documentJournal'
import type { ModelProvider } from '../../src/shared/workbench/modelProvider'

type Point = 'generating' | 'applied-unsaved' | 'saving' | 'save-after-rename' | 'save-after-rename-later-edit' | 'save-as-after-link' | 'save-as-clean-after-link' | 'save-after-rename-resource'
type Barrier = { type: 'kill-now'; point: Point; documentId: string; runId?: string; requestCount?: number;
  preview?: string[]; revision: number; undoDepth?: number; states?: string[]; runStatus?: string;
  requestStates?: string[]; fileSource: string; originalFileSource?: string }
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function killAt(directory: string, point: Point): Promise<Barrier> {
  const options: ForkOptions & { windowsHide: boolean } = {
    execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }
  const child = fork(path.resolve('tests/fixtures/g20M11InterruptedRecoveryWorker.ts'), [directory, point], options)
  let output = '', barrier: Barrier | undefined
  child.stderr?.on('data', bytes => { output += bytes.toString() })
  child.stdout?.on('data', bytes => { output += bytes.toString() })
  return new Promise<Barrier>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`M11 ${point} barrier timed out:\n${output}`)) }, 15000)
    child.on('message', message => {
      if ((message as { type?: string }).type === 'kill-now') {
        barrier = message as Barrier
        child.kill('SIGKILL')
      }
    })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', () => {
      clearTimeout(timer)
      barrier ? resolve(barrier) : reject(new Error(`M11 child exited before ${point} barrier:\n${output}`))
    })
  })
}

async function evidence(point: string, data: Record<string, unknown>): Promise<void> {
  const directory = path.resolve('output/g20/m11/t04')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, `${point}.json`), JSON.stringify({ point, ...data }, null, 2) + '\n')
}

it.each(['generating', 'applied-unsaved', 'saving', 'save-after-rename'] as const)(
  'M11-T04 real SIGKILL at %s restores only proven content without model replay', async point => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-interrupted-'))
    directories.push(directory)
    const barrier = await killAt(directory, point)
    expect(barrier.point).toBe(point)
    const fileAtRestart = point === 'save-after-rename' ? '# After\n' : '# Before\nOLD\n'
    expect(barrier.fileSource).toBe(fileAtRestart)
    expect(await fs.readFile(path.join(directory, 'lesson.md'), 'utf8')).toBe(fileAtRestart)

    const host = new DocumentHostService(path.join(directory, 'documents'))
    const recoverable = await host.internalAPI.recoverable()
    if (point !== 'save-after-rename')
      expect(recoverable.map(item => item.documentId)).toEqual(point === 'generating' ? [] : [barrier.documentId])
    const restored = await host.internalAPI.restore(barrier.documentId)
    const edits = new EditSessionService(host.registry, host.tools)
    expect(edits.list(barrier.documentId)).toEqual([])
    const expectedSource = point === 'generating' ? '# Before\nOLD\n'
      : point === 'saving' || point === 'save-after-rename' ? '# After\n' : '# Before\nAPPLIED\n'
    expect(restored).toMatchObject({ revision: point === 'generating' ? 0 : 1,
      undoDepth: point === 'generating' ? 0 : 1, saving: false, model: { source: expectedSource } })
    if (point !== 'save-after-rename')
      expect(restored).toMatchObject({ dirty: point !== 'generating', recovered: point !== 'generating' })

    let replayed = 0
    const sentinel: ModelProvider = { async *stream() { replayed += 1; throw new Error('Recovery must not call provider') } }
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, edits, runs, events, provider: sentinel })
    if (barrier.runId) {
      const recovered = await engine.recover()
      expect(recovered).toHaveLength(1)
      expect(recovered[0]).toMatchObject({ runId: barrier.runId, status: 'interrupted' })
      const record = (await runs.read(barrier.runId))!
      expect(record.requests.at(-1)).toMatchObject({ state: 'failed', failure: { outcome: 'unknown', code: 'interrupted-request' } })
      expect(record.tools).toHaveLength(point === 'generating' ? 0 : 1)
      if (point === 'applied-unsaved') {
        expect(record.tools[0]).toMatchObject({ state: 'returned', result: { kind: 'document-operation',
          result: { status: 'applied', revision: 1 } } })
        expect((await events.snapshot('m11-conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(1)
      } else expect((await events.snapshot('m11-conversation')).items.filter(item => item.type === 'document.commit')).toHaveLength(0)
      expect(await engine.recover()).toEqual([])
    }
    expect(replayed).toBe(0)
    expect((await host.internalAPI.read(barrier.documentId)).model).toMatchObject({ source: expectedSource })
    let acknowledgedRevisionAtRestart: number | null = null, historyRoundTrip = false
    if (point === 'generating') {
      expect(barrier.preview).toEqual(['HALF PRODUCT'])
      expect(barrier.requestCount).toBe(1)
      expect(barrier.revision).toBe(0)
    } else if (point === 'applied-unsaved') {
      expect(barrier.requestCount).toBe(2)
      expect(barrier.revision).toBe(1)
      expect(barrier.undoDepth).toBe(1)
    } else if (point === 'saving') {
      expect(barrier.states).toEqual(['saving'])
      const saved = await host.internalAPI.save(barrier.documentId)
      expect(saved).toMatchObject({ dirty: false, recovered: false, model: { source: '# After\n' } })
      expect(await fs.readFile(path.join(directory, 'lesson.md'), 'utf8')).toBe('# After\n')
    } else {
      expect(barrier.states).toEqual(['saving'])
      // Physical replacement is complete; recovery may acknowledge only the exact
      // saved revision and must retain canonical History for an explicit restore.
      const journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
      const durable = await journal.recover(barrier.documentId)
      acknowledgedRevisionAtRestart = durable?.savedRevision ?? null
      const beforeUndo = await host.internalAPI.read(barrier.documentId)
      const undo = await host.internalAPI.dispatch({ documentId: barrier.documentId, epoch: beforeUndo.epoch,
        baseRevision: beforeUndo.revision, operationId: 'undo-after-crash', actor: 'human', mutation: { type: 'undo' } })
      expect(undo).toMatchObject({ status: 'applied' })
      expect(await host.internalAPI.read(barrier.documentId)).toMatchObject({ revision: 2, undoDepth: 0, redoDepth: 1,
        model: { source: '# Before\nOLD\n' } })
      const beforeRedo = await host.internalAPI.read(barrier.documentId)
      const redo = await host.internalAPI.dispatch({ documentId: barrier.documentId, epoch: beforeRedo.epoch,
        baseRevision: beforeRedo.revision, operationId: 'redo-after-crash', actor: 'human', mutation: { type: 'redo' } })
      expect(redo).toMatchObject({ status: 'applied' })
      expect(await host.internalAPI.read(barrier.documentId)).toMatchObject({ revision: 3, undoDepth: 1, redoDepth: 0,
        model: { source: '# After\n' } })
      const saved = await host.internalAPI.save(barrier.documentId)
      expect(saved).toMatchObject({ dirty: false, recovered: false, model: { source: '# After\n' } })
      expect(await fs.readFile(path.join(directory, 'lesson.md'), 'utf8')).toBe('# After\n')
      expect(recoverable).toEqual([])
      expect(restored).toMatchObject({ dirty: false, recovered: false })
      expect(durable).toMatchObject({ revision: 1, savedRevision: 1,
        binding: { kind: 'file', version: restored.binding.kind === 'file' ? restored.binding.version : null } })
      historyRoundTrip = true
    }
    await evidence(point, { barrier, restored: { revision: restored.revision, undoDepth: restored.undoDepth,
      dirty: restored.dirty, recovered: restored.recovered, source: expectedSource },
      originalFileAtRestart: fileAtRestart, providerCallsOnRecovery: replayed,
      ...(point === 'save-after-rename' ? { acknowledgedRevisionAtRestart, historyRoundTrip } : {}),
      ...(barrier.runId ? { recoveredRun: (await runs.read(barrier.runId))?.status } : {}) })
  }, 20000,
)

it('M11-T04 a concurrent r+1 edit stays dirty after recovery acknowledges only saved r', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-later-edit-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-after-rename-later-edit')
  expect(barrier).toMatchObject({ states: ['saving'], revision: 2, fileSource: '# After\n' })
  const host = new DocumentHostService(path.join(directory, 'documents'))
  expect(await host.internalAPI.recoverable()).toMatchObject([{ documentId: barrier.documentId,
    revision: 2, undoDepth: 2, model: { source: '# After\nLATER\n' } }])
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ dirty: true, recovered: true, revision: 2, undoDepth: 2,
    model: { source: '# After\nLATER\n' } })
  const diskVersion = await readDocumentFileVersion(path.join(directory, 'lesson.md'), 'markdown')
  const journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  expect(await journal.recover(barrier.documentId)).toMatchObject({ revision: 2, savedRevision: 1,
    binding: { version: diskVersion } })
  const saved = await host.internalAPI.save(barrier.documentId)
  expect(saved).toMatchObject({ dirty: false, recovered: false, revision: 2, undoDepth: 2 })
  expect(await fs.readFile(path.join(directory, 'lesson.md'), 'utf8')).toBe('# After\nLATER\n')
  await evidence('save-after-rename-later-edit', { barrier, restored: { revision: restored.revision,
    dirty: restored.dirty, recovered: restored.recovered, undoDepth: restored.undoDepth },
    recoveredSavedRevision: 1, savedSource: '# After\nLATER\n' })
}, 20000)

it('M11-T04 Save As linked before ACK restores the new binding without losing History', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-save-as-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-as-after-link')
  const original = path.join(directory, 'lesson.md'), target = path.join(directory, 'save-as.md')
  expect(barrier).toMatchObject({ states: ['saving'], fileSource: '# After\n', originalFileSource: '# Before\nOLD\n' })
  expect(await fs.readFile(original, 'utf8')).toBe('# Before\nOLD\n')
  expect(await fs.readFile(target, 'utf8')).toBe('# After\n')
  const host = new DocumentHostService(path.join(directory, 'documents'))
  expect(await host.internalAPI.recoverable()).toEqual([])
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ dirty: false, recovered: false, revision: 1, undoDepth: 1,
    binding: { kind: 'file', path: target, bindingVersion: 2 }, model: { source: '# After\n' } })
  const diskVersion = await readDocumentFileVersion(target, 'markdown')
  expect(await createDocumentJournal({ directory: path.join(directory, 'documents') }).recover(barrier.documentId))
    .toMatchObject({ savedRevision: 1, binding: { path: target, version: diskVersion } })
  const undo = await host.internalAPI.dispatch({ documentId: barrier.documentId, epoch: restored.epoch,
    baseRevision: 1, operationId: 'save-as-undo', actor: 'human', mutation: { type: 'undo' } })
  expect(undo).toMatchObject({ status: 'applied' })
  const redo = await host.internalAPI.dispatch({ documentId: barrier.documentId, epoch: restored.epoch,
    baseRevision: 2, operationId: 'save-as-redo', actor: 'human', mutation: { type: 'redo' } })
  expect(redo).toMatchObject({ status: 'applied' })
  await host.internalAPI.save(barrier.documentId)
  expect(await fs.readFile(target, 'utf8')).toBe('# After\n')
  expect(await fs.readFile(original, 'utf8')).toBe('# Before\nOLD\n')
  await evidence('save-as-after-link', { barrier, recoveredBinding: target, recoveredSavedRevision: 1,
    originalSource: '# Before\nOLD\n', targetSource: '# After\n' })
}, 20000)

it('M11-T04 clean Save As linked before ACK restores its new binding at the same saved revision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-clean-save-as-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-as-clean-after-link')
  const original = path.join(directory, 'lesson.md'), target = path.join(directory, 'save-as.md')
  expect(barrier).toMatchObject({ states: ['saving'], revision: 0,
    fileSource: '# Before\nOLD\n', originalFileSource: '# Before\nOLD\n' })
  const journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  const durable = await journal.recover(barrier.documentId)
  const version = await readDocumentFileVersion(target, 'markdown')
  expect(durable).toMatchObject({ revision: 0, savedRevision: 0, past: [],
    binding: { kind: 'file', path: target, version, bindingVersion: 2 } })
  // A second recovery must not append another acknowledgement for this stale intent.
  expect((await journal.recover(barrier.documentId))?.sequence).toBe(durable?.sequence)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  expect(await host.internalAPI.recoverable()).toEqual([])
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ revision: 0, dirty: false, recovered: false, undoDepth: 0,
    binding: { kind: 'file', path: target, version, bindingVersion: 2 }, model: { source: '# Before\nOLD\n' } })
  await host.internalAPI.save(barrier.documentId)
  expect(await fs.readFile(target, 'utf8')).toBe('# Before\nOLD\n')
  expect(await fs.readFile(original, 'utf8')).toBe('# Before\nOLD\n')
  await evidence('save-as-clean-after-link', { barrier, recoveredBinding: target,
    recoveredSavedRevision: 0, recoveredSequence: durable?.sequence, originalPreserved: true })
}, 20000)

it('M11-T04 clean Save As does not infer its new binding if the target changed after linking', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-clean-save-as-external-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-as-clean-after-link')
  const original = path.join(directory, 'lesson.md'), target = path.join(directory, 'save-as.md')
  await fs.writeFile(target, '# External\n')
  const journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  const durable = await journal.recover(barrier.documentId)
  expect(durable).toMatchObject({ revision: 0, savedRevision: 0,
    binding: { kind: 'file', path: original, bindingVersion: 1 } })
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ dirty: false, recovered: false,
    binding: { kind: 'file', path: original, bindingVersion: 1 } })
  expect(await fs.readFile(target, 'utf8')).toBe('# External\n')
  await evidence('save-as-clean-after-link-external-change', { barrier,
    inferredBinding: false, recoveredBinding: original, externalTargetPreserved: true })
}, 20000)

it('M11-T04 a stale Save As intent cannot replace a newer durable saved revision', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-stale-save-as-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-as-clean-after-link')
  const target = path.join(directory, 'save-as.md'), held = path.join(directory, 'save-as.held')
  const journal = createDocumentJournal({ directory: path.join(directory, 'documents') })
  // Hide the published target only while reading the pre-ACK state, then append
  // a later durable save. Restore the exact target so the old intent could match.
  await fs.rename(target, held)
  const before = await journal.recover(barrier.documentId)
  if (!before) throw new Error('Missing pre-ACK journal state')
  const newer = { ...before, sequence: before.sequence + 1, revision: before.revision + 1,
    savedRevision: before.revision + 1 }
  await journal.append(newer)
  await fs.rename(held, target)
  expect(await readDocumentFileVersion(target, 'markdown')).not.toBeNull()
  const recovered = await journal.recover(barrier.documentId)
  expect(recovered).toMatchObject({ sequence: newer.sequence, revision: newer.revision,
    savedRevision: newer.savedRevision, binding: before.binding })
  await evidence('save-as-clean-stale-intent', { barrier, newerSavedRevision: newer.savedRevision,
    recoveredSequence: recovered?.sequence, bindingPreserved: true })
}, 20000)

it('M11-T04 refuses save ACK inference when the post-replace disk version has changed externally', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-external-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-after-rename')
  const filename = path.join(directory, 'lesson.md')
  expect(barrier.fileSource).toBe('# After\n')
  await fs.writeFile(filename, '# External\n')
  const host = new DocumentHostService(path.join(directory, 'documents'))
  expect(await host.internalAPI.recoverable()).toMatchObject([{ documentId: barrier.documentId,
    dirty: true, model: { source: '# After\n' } }])
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ dirty: true, recovered: true, revision: 1, model: { source: '# After\n' } })
  await expect(host.internalAPI.save(barrier.documentId)).rejects.toMatchObject({ code: 'file-conflict' })
  expect(await fs.readFile(filename, 'utf8')).toBe('# External\n')
  await evidence('save-after-rename-external-change', { barrier, externalAfterCrash: '# External\n',
    inferredSaveAck: false, recoverable: true, saveConflictPreserved: true })
}, 20000)

it('M11-T04 refuses save ACK inference when only a referenced attachment changed after replacement', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m11-resource-'))
  directories.push(directory)
  const barrier = await killAt(directory, 'save-after-rename-resource')
  const filename = path.join(directory, 'lesson.md'), asset = path.join(directory, 'asset.png')
  expect(barrier.fileSource).toBe('# After\n![asset](asset.png)\n')
  const bodyVersion = await readDocumentFileVersion(filename, 'markdown')
  await fs.writeFile(asset, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64'))
  expect(await fs.readFile(filename, 'utf8')).toBe(barrier.fileSource)
  expect(await readDocumentFileVersion(filename, 'markdown')).not.toBe(bodyVersion)
  const host = new DocumentHostService(path.join(directory, 'documents'))
  expect(await host.internalAPI.recoverable()).toMatchObject([{ documentId: barrier.documentId, dirty: true }])
  const restored = await host.internalAPI.restore(barrier.documentId)
  expect(restored).toMatchObject({ dirty: true, recovered: true, model: { source: barrier.fileSource } })
  await expect(host.internalAPI.save(barrier.documentId)).rejects.toMatchObject({ code: 'file-conflict' })
  expect(await fs.readFile(filename, 'utf8')).toBe(barrier.fileSource)
  await evidence('save-after-rename-resource-change', { barrier, bodyUnchanged: true,
    attachmentVersionChanged: true, inferredSaveAck: false, saveConflictPreserved: true })
}, 20000)
