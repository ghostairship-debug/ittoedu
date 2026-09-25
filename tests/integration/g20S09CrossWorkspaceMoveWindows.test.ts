// @vitest-environment node
import { constants, promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const testCase = process.platform === 'win32' ? it : it.skip
const outputBase = path.resolve(__dirname, '../../output/g20/s09')
const evidenceFile = path.join(outputBase, 'cross-volume-move', 'integration-evidence.json')

testCase('S09-T03 moves a mixed batch across actual C: and D: volumes without losing sources or bindings', async () => {
  await fs.mkdir(outputBase, { recursive: true })
  await fs.rm(evidenceFile, { force: true })
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-source-'))
  const destinationRoot = await fs.mkdtemp(path.join(outputBase, 'cross-volume-target-'))
  try {
    const sourceDevice = (await fs.stat(sourceRoot)).dev, destinationDevice = (await fs.stat(destinationRoot)).dev
    expect(path.parse(sourceRoot).root.toLowerCase()).toBe('c:\\')
    expect(path.parse(destinationRoot).root.toLowerCase()).toBe('d:\\')
    expect(sourceDevice).not.toBe(destinationDevice)
    const source = (name: string) => path.join(sourceRoot, name)
    const target = (name: string) => path.join(destinationRoot, name)
    for (const name of ['good.md', 'corrupt.md', 'busy.md']) await fs.writeFile(source(name), `${name} disk`)

    const removeAttempts: string[] = []
    const host = new DocumentHostService(path.join(destinationRoot, 'recovery'), { fileOperations: {
      copy: async (from, to, kind) => {
        if (kind !== 'file') throw new Error('This fixture uses regular files only')
        await fs.copyFile(from, to, constants.COPYFILE_EXCL)
        if (from === source('corrupt.md')) await fs.writeFile(to, 'injected corrupt copy')
      },
      remove: async filename => {
        removeAttempts.push(filename)
        if (filename === source('busy.md')) throw Object.assign(new Error('occupied source'), { code: 'EBUSY' })
        await fs.rm(filename, { recursive: true, force: false })
      },
    } })
    const opened = new Map<string, DocumentSnapshot>()
    for (const name of ['good.md', 'corrupt.md', 'busy.md']) opened.set(name, await host.open(source(name)))
    for (const name of ['good.md', 'busy.md']) {
      const snapshot = opened.get(name)!
      await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        operationId: `edit-${name}`, actor: 'human', baseRevision: snapshot.revision,
        mutation: { type: 'command', command: { type: 'markdown.replace', source: `${name} edited` } } })
    }
    const sourceWorkspace = await host.files.registerRoot(sourceRoot)
    const targetWorkspace = await host.files.registerRoot(destinationRoot)
    const listed = await host.files.listChildren({ workspaceId: sourceWorkspace.workspaceId,
      directoryEntryId: sourceWorkspace.rootEntryId })
    const entryId = (name: string) => {
      const found = listed.entries.find(entry => entry.status === 'accessible' && entry.name === name)
      if (!found || found.status !== 'accessible') throw new Error(`Missing fixture entry: ${name}`)
      return found.entryId
    }
    const ids = ['good.md', 'corrupt.md', 'busy.md'].map(entryId)
    const result = await host.files.move({ operationId: 'cross-volume-mixed-batch', workspaceId: sourceWorkspace.workspaceId,
      targetWorkspaceId: targetWorkspace.workspaceId, sourceEntryIds: ids, targetDirectoryId: targetWorkspace.rootEntryId })
    expect(result).toMatchObject({ status: 'partial', items: [
      { sourceEntryId: ids[0], status: 'success', entryId: ids[0] },
      { sourceEntryId: ids[1], status: 'failed', error: { code: 'copy-verification-failed' } },
      { sourceEntryId: ids[2], status: 'partial', error: { code: 'source-delete-failed' } },
    ] })
    expect(removeAttempts).toContain(source('good.md'))
    expect(removeAttempts).toContain(source('busy.md'))
    expect(removeAttempts).not.toContain(source('corrupt.md'))
    await expect(fs.stat(source('good.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(target('good.md'), 'utf8')).toBe('good.md disk')
    expect(await fs.readFile(source('corrupt.md'), 'utf8')).toBe('corrupt.md disk')
    await expect(fs.stat(target('corrupt.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(source('busy.md'), 'utf8')).toBe('busy.md disk')
    expect(await fs.readFile(target('busy.md'), 'utf8')).toBe('busy.md disk')
    expect((await host.files.resolveEntry(targetWorkspace.workspaceId, ids[0]!)).resolvedPath).toBe(target('good.md'))
    await expect(host.files.resolveEntry(sourceWorkspace.workspaceId, ids[0]!)).rejects.toMatchObject({ code: 'unknown-entry' })
    expect((await host.files.resolveEntry(sourceWorkspace.workspaceId, ids[2]!)).resolvedPath).toBe(source('busy.md'))
    expect((await host.files.resolveEntry(targetWorkspace.workspaceId, result.items[2]!.entryId!)).resolvedPath).toBe(target('busy.md'))

    const goodDocument = opened.get('good.md')!, busyDocument = opened.get('busy.md')!
    expect(await host.internalAPI.read(goodDocument.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: target('good.md') } })
    expect(await host.internalAPI.read(busyDocument.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: source('busy.md') } })
    await host.saveToPath(goodDocument.documentId)
    await host.saveToPath(busyDocument.documentId)
    expect(await fs.readFile(target('good.md'), 'utf8')).toBe('good.md edited')
    expect(await fs.readFile(source('busy.md'), 'utf8')).toBe('busy.md edited')
    expect(await fs.readFile(target('busy.md'), 'utf8')).toBe('busy.md disk')
    await expect(fs.stat(source('good.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = await new DocumentHostService(path.join(destinationRoot, 'reopen')).open(target('good.md'))
    expect(reopened.model).toMatchObject({ source: 'good.md edited' })

    await fs.mkdir(path.dirname(evidenceFile), { recursive: true })
    await fs.writeFile(evidenceFile, JSON.stringify({
      caseId: 'S09-T03-CROSS-VOLUME-MIXED', result: 'passed', testLayer: 'Windows integration, real C:/D: disks',
      capturedAt: new Date().toISOString(), volumes: { sourceDrive: 'C:', targetDrive: 'D:', distinctDeviceIds: sourceDevice !== destinationDevice },
      failureInjection: { corruptCopyBeforeDelete: true, busySourceDeleteCode: 'EBUSY' },
      receipt: result.items.map(item => ({ status: item.status, errorCode: item.error?.code ?? null,
        sourceEntryPresent: !!item.sourceEntryId, destinationEntryPresent: !!item.entryId })),
      disk: { successfulSourceAbsent: true, successfulTargetSavedAndReopened: true,
        corruptSourcePreserved: true, corruptTargetAbsent: true, corruptSourceDeleteNeverAttempted: true,
        busySourcePreservedAndSaved: true, busyVerifiedTargetRetainedOriginalBytes: true },
      binding: { successfulDocumentMovedToTarget: true, failedDeleteDocumentRemainedAtSource: true,
        historyRetained: true },
    }, null, 2), 'utf8')
  } finally {
    const allowedSource = path.resolve(os.tmpdir()) + path.sep
    const allowedDestination = outputBase + path.sep
    if (!path.resolve(sourceRoot).startsWith(allowedSource) || !path.resolve(destinationRoot).startsWith(allowedDestination)) {
      throw new Error('Unsafe S09 cross-volume fixture cleanup')
    }
    await fs.rm(sourceRoot, { recursive: true, force: true })
    await fs.rm(destinationRoot, { recursive: true, force: true })
  }
}, 30_000)

testCase('S09-T03 overlapping authorized roots treat the same physical source and target as a no-op', async () => {
  await fs.mkdir(outputBase, { recursive: true })
  const noOpEvidence = path.join(outputBase, 'cross-volume-move', 'nested-root-noop-evidence.json')
  await fs.rm(noOpEvidence, { force: true })
  const parent = await fs.mkdtemp(path.join(outputBase, 'nested-root-'))
  try {
    const nested = path.join(parent, 'sub'), filename = path.join(nested, 'a.md')
    await fs.mkdir(nested)
    await fs.writeFile(filename, '# Original\n')
    const calls: string[] = []
    const host = new DocumentHostService(path.join(parent, 'recovery'), { fileOperations: {
      rename: async () => { calls.push('rename'); throw new Error('Same-path move must not rename') },
      copy: async () => { calls.push('copy'); throw new Error('Same-path move must not copy') },
      remove: async () => { calls.push('remove'); throw new Error('Same-path move must not remove') },
    } })
    const opened = await host.open(filename)
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch,
      operationId: 'nested-root-dirty-edit', actor: 'human', baseRevision: opened.revision,
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '# Still here\n' } } })
    const sourceRoot = await host.files.registerRoot(parent), targetRoot = await host.files.registerRoot(nested)
    const top = await host.files.listChildren({ workspaceId: sourceRoot.workspaceId, directoryEntryId: sourceRoot.rootEntryId })
    const sub = top.entries.find(item => item.status === 'accessible' && item.name === 'sub')
    if (!sub || sub.status !== 'accessible') throw new Error('Missing nested directory handle')
    const inside = await host.files.listChildren({ workspaceId: sourceRoot.workspaceId, directoryEntryId: sub.entryId })
    const file = inside.entries.find(item => item.status === 'accessible' && item.name === 'a.md')
    if (!file || file.status !== 'accessible') throw new Error('Missing source file handle')
    const result = await host.files.move({ operationId: 'nested-root-same-file', workspaceId: sourceRoot.workspaceId,
      targetWorkspaceId: targetRoot.workspaceId, sourceEntryIds: [file.entryId], targetDirectoryId: targetRoot.rootEntryId })
    expect(result).toMatchObject({ status: 'success', items: [{ status: 'success', sourceEntryId: file.entryId,
      entryId: file.entryId, sourcePath: filename, targetPath: filename }] })
    expect(calls).toEqual([])
    expect(await fs.readFile(filename, 'utf8')).toBe('# Original\n')
    expect((await host.files.resolveEntry(sourceRoot.workspaceId, file.entryId)).resolvedPath).toBe(filename)
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ documentId: opened.documentId,
      revision: 1, undoDepth: 1, dirty: true, binding: { path: filename, bindingVersion: 1 } })
    await host.saveToPath(opened.documentId)
    expect(await fs.readFile(filename, 'utf8')).toBe('# Still here\n')
    expect(calls).toEqual([])
    await fs.mkdir(path.dirname(noOpEvidence), { recursive: true })
    await fs.writeFile(noOpEvidence, JSON.stringify({ caseId: 'S09-T03-NESTED-ROOT-SAME-PATH', result: 'passed',
      capturedAt: new Date().toISOString(), testLayer: 'Windows DocumentHostService integration',
      roots: { parentAndNestedBothAuthorized: true, samePhysicalPath: true },
      observed: { receipt: result.status, renameCalls: 0, copyCalls: 0, removeCalls: 0,
        originalBytesRetainedUntilSave: true, documentBindingAndHistoryRetained: true, saveAtSamePath: true },
    }, null, 2), 'utf8')
  } finally {
    if (!path.resolve(parent).startsWith(outputBase + path.sep)) throw new Error('Unsafe nested-root fixture cleanup')
    await fs.rm(parent, { recursive: true, force: true })
  }
}, 30_000)

testCase('S09-T03 does not delete a source changed after a verified cross-volume copy', async () => {
  await fs.mkdir(outputBase, { recursive: true })
  const evidence = path.join(outputBase, 'cross-volume-move', 'source-changed-evidence.json')
  await fs.rm(evidence, { force: true })
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-source-change-'))
  const targetRoot = await fs.mkdtemp(path.join(outputBase, 'source-change-target-'))
  try {
    expect((await fs.stat(sourceRoot)).dev).not.toBe((await fs.stat(targetRoot)).dev)
    const original = path.join(sourceRoot, 'changed.md'), copied = path.join(targetRoot, 'changed.md')
    await fs.writeFile(original, '# Before\n')
    const removes: string[] = []
    const host = new DocumentHostService(path.join(targetRoot, 'recovery'), { fileOperations: {
      rename: async (from, to) => {
        await fs.rename(from, to)
        if (to === copied) await fs.writeFile(original, '# External change after verified copy\n')
      },
      remove: async filename => { removes.push(filename); await fs.rm(filename, { recursive: true, force: false }) },
    } })
    const opened = await host.open(original)
    const source = await host.files.registerRoot(sourceRoot), target = await host.files.registerRoot(targetRoot)
    const listed = await host.files.listChildren({ workspaceId: source.workspaceId, directoryEntryId: source.rootEntryId })
    const item = listed.entries.find(entry => entry.status === 'accessible' && entry.name === 'changed.md')
    if (!item || item.status !== 'accessible') throw new Error('Missing source fixture handle')
    const result = await host.files.move({ operationId: 'source-changes-after-copy', workspaceId: source.workspaceId,
      targetWorkspaceId: target.workspaceId, sourceEntryIds: [item.entryId], targetDirectoryId: target.rootEntryId })
    expect(result).toMatchObject({ status: 'partial', items: [{ status: 'partial',
      error: { code: 'source-changed-after-copy' } }] })
    expect(removes).not.toContain(original)
    expect(await fs.readFile(original, 'utf8')).toBe('# External change after verified copy\n')
    expect(await fs.readFile(copied, 'utf8')).toBe('# Before\n')
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ binding: { path: original, bindingVersion: 1 } })
    await fs.mkdir(path.dirname(evidence), { recursive: true })
    await fs.writeFile(evidence, JSON.stringify({ caseId: 'S09-T03-SOURCE-CHANGED-AFTER-COPY', result: 'passed',
      capturedAt: new Date().toISOString(), testLayer: 'Windows real C:/D: integration with mutation injected after target publish',
      observed: { receipt: result.status, errorCode: result.items[0]?.error?.code,
        sourceDeleteAttempted: removes.includes(original), changedSourcePreserved: true,
        verifiedEarlierCopyRetained: true, openBindingRemainedAtSource: true },
    }, null, 2), 'utf8')
  } finally {
    if (!path.resolve(sourceRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.resolve(targetRoot).startsWith(outputBase + path.sep)) throw new Error('Unsafe S09 fixture cleanup')
    await fs.rm(sourceRoot, { recursive: true, force: true })
    await fs.rm(targetRoot, { recursive: true, force: true })
  }
}, 30_000)

testCase('S09-T03 partial directory deletion rebinds only children actually removed from the source', async () => {
  await fs.mkdir(outputBase, { recursive: true })
  const evidence = path.join(outputBase, 'cross-volume-move', 'partial-directory-evidence.json')
  await fs.rm(evidence, { force: true })
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-partial-directory-'))
  const targetRoot = await fs.mkdtemp(path.join(outputBase, 'partial-directory-target-'))
  try {
    expect((await fs.stat(sourceRoot)).dev).not.toBe((await fs.stat(targetRoot)).dev)
    const original = path.join(sourceRoot, 'lesson'), copied = path.join(targetRoot, 'lesson')
    await fs.mkdir(original)
    await fs.writeFile(path.join(original, 'a.md'), '# A disk\n')
    await fs.writeFile(path.join(original, 'busy.md'), '# Busy disk\n')
    const host = new DocumentHostService(path.join(targetRoot, 'recovery'), { fileOperations: {
      remove: async filename => {
        if (filename === original) {
          await fs.rm(path.join(original, 'a.md'))
          throw Object.assign(new Error('busy child'), { code: 'EBUSY' })
        }
        await fs.rm(filename, { recursive: true, force: false })
      },
    } })
    const a = await host.open(path.join(original, 'a.md'))
    const busy = await host.open(path.join(original, 'busy.md'))
    for (const [snapshot, source] of [[a, '# A edited\n'], [busy, '# Busy edited\n']] as const) {
      await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        operationId: `edit-${snapshot.documentId}`, actor: 'human', baseRevision: snapshot.revision,
        mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
    }
    const source = await host.files.registerRoot(sourceRoot), target = await host.files.registerRoot(targetRoot)
    const listed = await host.files.listChildren({ workspaceId: source.workspaceId, directoryEntryId: source.rootEntryId })
    const folder = listed.entries.find(entry => entry.status === 'accessible' && entry.name === 'lesson')
    if (!folder || folder.status !== 'accessible') throw new Error('Missing source directory handle')
    const result = await host.files.move({ operationId: 'partial-directory-source-delete', workspaceId: source.workspaceId,
      targetWorkspaceId: target.workspaceId, sourceEntryIds: [folder.entryId], targetDirectoryId: target.rootEntryId })
    expect(result).toMatchObject({ status: 'partial', items: [{ status: 'partial',
      error: { code: 'source-delete-failed' } }] })
    await expect(fs.stat(path.join(original, 'a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(original, 'busy.md'), 'utf8')).toBe('# Busy disk\n')
    expect(await fs.readFile(path.join(copied, 'a.md'), 'utf8')).toBe('# A disk\n')
    expect(await fs.readFile(path.join(copied, 'busy.md'), 'utf8')).toBe('# Busy disk\n')
    expect(await host.internalAPI.read(a.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: path.join(copied, 'a.md'), bindingVersion: 2 } })
    expect(await host.internalAPI.read(busy.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: path.join(original, 'busy.md'), bindingVersion: 1 } })
    await host.saveToPath(a.documentId)
    await host.saveToPath(busy.documentId)
    expect(await fs.readFile(path.join(copied, 'a.md'), 'utf8')).toBe('# A edited\n')
    expect(await fs.readFile(path.join(original, 'busy.md'), 'utf8')).toBe('# Busy edited\n')
    expect(await fs.readFile(path.join(copied, 'busy.md'), 'utf8')).toBe('# Busy disk\n')
    await expect(fs.stat(path.join(original, 'a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(path.dirname(evidence), { recursive: true })
    await fs.writeFile(evidence, JSON.stringify({ caseId: 'S09-T03-PARTIAL-DIRECTORY-DELETE', result: 'passed',
      capturedAt: new Date().toISOString(), testLayer: 'Windows real C:/D: integration with partial recursive delete injection',
      observed: { receipt: result.status, errorCode: result.items[0]?.error?.code,
        removedChildBoundToTarget: true, survivingChildBoundToSource: true, bothHistoriesRetained: true,
        removedOldPathNotRecreatedOnSave: true, survivingSourceSaved: true, targetCopyOfSurvivorUntouched: true },
    }, null, 2), 'utf8')
  } finally {
    if (!path.resolve(sourceRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.resolve(targetRoot).startsWith(outputBase + path.sep)) throw new Error('Unsafe S09 fixture cleanup')
    await fs.rm(sourceRoot, { recursive: true, force: true })
    await fs.rm(targetRoot, { recursive: true, force: true })
  }
}, 30_000)

testCase('S09-T03 cold repair resolves each document after a partly deleted source directory', async () => {
  await fs.mkdir(outputBase, { recursive: true })
  const evidence = path.join(outputBase, 'cross-volume-move', 'partial-directory-cold-repair-evidence.json')
  await fs.rm(evidence, { force: true })
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s09-cold-partial-'))
  const targetRoot = await fs.mkdtemp(path.join(outputBase, 'cold-partial-target-'))
  try {
    expect((await fs.stat(sourceRoot)).dev).not.toBe((await fs.stat(targetRoot)).dev)
    const source = path.join(sourceRoot, 'lesson'), target = path.join(targetRoot, 'lesson')
    const recovery = path.join(targetRoot, 'recovery')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'a.md'), '# A disk\n')
    await fs.writeFile(path.join(source, 'busy.md'), '# Busy disk\n')
    const initial = new DocumentHostService(recovery)
    const a = await initial.open(path.join(source, 'a.md'))
    const busy = await initial.open(path.join(source, 'busy.md'))
    for (const [snapshot, content] of [[a, '# A recovered\n'], [busy, '# Busy recovered\n']] as const) {
      await initial.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        operationId: `cold-edit-${snapshot.documentId}`, actor: 'human', baseRevision: snapshot.revision,
        mutation: { type: 'command', command: { type: 'markdown.replace', source: content } } })
    }
    const bindingA = (await initial.internalAPI.read(a.documentId)).binding
    const bindingBusy = (await initial.internalAPI.read(busy.documentId)).binding
    if (bindingA.kind !== 'file' || bindingBusy.kind !== 'file') throw new Error('Expected file bindings')
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false })
    await fs.rm(path.join(source, 'a.md'))
    const operationId = 'crash-after-partial-directory-delete'
    const entries = [
      { documentId: a.documentId, before: bindingA,
        after: { ...bindingA, path: path.join(target, 'a.md'), bindingVersion: bindingA.bindingVersion + 1 } },
      { documentId: busy.documentId, before: bindingBusy,
        after: { ...bindingBusy, path: path.join(target, 'busy.md'), bindingVersion: bindingBusy.bindingVersion + 1 } },
    ]
    const intentDirectory = path.join(recovery, 'binding-intents')
    await fs.mkdir(intentDirectory, { recursive: true })
    const name = createHash('sha256').update(`${operationId}\0${source}`).digest('hex') + '.json'
    await fs.writeFile(path.join(intentDirectory, name), JSON.stringify({ schemaVersion: 1, operationId,
      source, target, kind: 'move', entries }))
    const restarted = new DocumentHostService(recovery)
    await restarted.fileCoordinator.repairBindings()
    const recoverable = await restarted.operate({ type: 'recoverable' }) as DocumentSnapshot[]
    expect(recoverable.find(item => item.documentId === a.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: path.join(target, 'a.md'), bindingVersion: bindingA.bindingVersion + 1 } })
    expect(recoverable.find(item => item.documentId === busy.documentId)).toMatchObject({ revision: 1, undoDepth: 1,
      binding: { path: path.join(source, 'busy.md'), bindingVersion: bindingBusy.bindingVersion } })
    await restarted.operate({ type: 'restore', documentId: a.documentId })
    await restarted.operate({ type: 'restore', documentId: busy.documentId })
    await restarted.saveToPath(a.documentId)
    await restarted.saveToPath(busy.documentId)
    expect(await fs.readFile(path.join(target, 'a.md'), 'utf8')).toBe('# A recovered\n')
    expect(await fs.readFile(path.join(source, 'busy.md'), 'utf8')).toBe('# Busy recovered\n')
    expect(await fs.readFile(path.join(target, 'busy.md'), 'utf8')).toBe('# Busy disk\n')
    await expect(fs.stat(path.join(source, 'a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(intentDirectory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.mkdir(path.dirname(evidence), { recursive: true })
    await fs.writeFile(evidence, JSON.stringify({ caseId: 'S09-T03-PARTIAL-DIRECTORY-COLD-REPAIR', result: 'passed',
      capturedAt: new Date().toISOString(), testLayer: 'Windows real C:/D: cold DocumentHostService recovery',
      observed: { deletedChildReboundToVerifiedTarget: true, survivingChildRetainedSourceBinding: true,
        historiesRetained: true, bothSavedToCorrectPaths: true, oldDeletedPathNotRecreated: true, intentResolved: true },
    }, null, 2), 'utf8')
  } finally {
    if (!path.resolve(sourceRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)
      || !path.resolve(targetRoot).startsWith(outputBase + path.sep)) throw new Error('Unsafe S09 fixture cleanup')
    await fs.rm(sourceRoot, { recursive: true, force: true })
    await fs.rm(targetRoot, { recursive: true, force: true })
  }
}, 30_000)
