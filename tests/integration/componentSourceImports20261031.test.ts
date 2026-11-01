// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { transform } from 'esbuild'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { liveSourceOwners } from '../../src/core/components/compilation/liveSourceReferences'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { ComponentEdit, ComponentImplementation } from '../../src/shared/contracts/component-platform'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { testContainerInstance } from '../helpers/glxWorkFixture'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const work of cleanups.splice(0).reverse()) await work() })
const bytes = (text: string) => new TextEncoder().encode(text)
const modelText = (initial: number) => `export const INITIAL = ${initial}; export const result = used => ({ initial: INITIAL, used, remaining: INITIAL - used });`
const entry = `import { INITIAL, result } from './model.js';
export { INITIAL, result } from './model.js';
export const document = 'web';
export function mount(context) { context.root.textContent = String(result(20).remaining); return { dispose() {} }; }`
const course = (snapshot: DocumentSnapshot) => {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected course')
  return snapshot.model
}

async function fixture(writable: 'document' | 'record-only' = 'document') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'source-imports-'))
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const project = createBlankCourseProjectV10('Native teacher handoff')
  for (const id of ['bench', 'record']) {
    project.definitions[id] = { id, title: id, role: 'content', implementation: {
      kind: 'source', language: 'javascript', workspace: { ownerId: `${id}-owner`, entry: 'main.js' },
      ...(id === 'record' ? { moduleBindings: { './unrelated': 'unchanged' } } : {}),
    } }
    project.instances[id] = { id, definitionId: id, data: { teacherText: `${id}: 人工保留` },
      frame: { width: 300, height: 100, transform: [1, 0, 0, 1, id === 'bench' ? 40 : 420, 50] } }
  }
  project.definitions.unchanged = { id: 'unchanged', role: 'behavior', implementation: { kind: 'source', language: 'javascript', source: 'export const unused = true;' } }
  project.definitions.wrong = { id: 'wrong', title: 'missing-export', role: 'behavior',
    implementation: { kind: 'source', language: 'javascript', source: 'export const unrelated = 3;' } }
  const surface = testContainerInstance(project, 0); surface.childIds = ['bench', 'record']
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {
    'bench-owner': { 'main.js': bytes(entry), 'model.js': bytes(modelText(60)), 'unchanged.bin': new Uint8Array([255, 254]) },
    'record-owner': { 'main.js': bytes(entry), 'model.js': bytes(modelText(99)) },
  } } }, 'shared-source.glx')
  const runId = 'source-import-run'
  await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: snapshot.documentId,
    writable: writable === 'document' ? [{ kind: 'document' }] : [{ kind: 'course-instance', surfaceId: surface.id, instanceId: 'record' }] }] })
  cleanups.push(async () => { await host.tools.stop(runId); await host.operate({ type: 'close', documentId: snapshot.documentId, discardDirty: true }) })
  let sequence = 0
  const read = () => host.internalAPI.read(snapshot.documentId)
  const call = (name: string, input: unknown) => host.tools.execute(runId, `call-${++sequence}`, { name, input })
  const sourcePath = async (definitionId: string, filename = 'main.js') => {
    const model = course(await read())
    return componentProjectFiles(model.project, model.resources).find(file => file.binding?.kind === 'definition-source'
      && file.binding.definitionId === definitionId && !file.authorSource?.dependencyId && file.kind === 'source'
      && (!file.sourceFile || file.sourceFile.path === filename))!.path
  }
  const paths = { bench: await sourcePath('bench'), record: await sourcePath('record'), model: await sourcePath('bench', 'model.js'), wrong: await sourcePath('wrong') }
  const observe = async () => {
    for (const source of [paths.record, paths.bench]) expect(await call('project.read', { path: source })).toMatchObject({ kind: 'read' })
  }
  const link = (value: string | null = paths.bench) => call('project.apply', { path: paths.record, intent: 'source.imports', imports: { './model.js': value } })
  const human = async (edits: ComponentEdit[]) => {
    const before = await read(), model = course(before)
    const result = await host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision,
      operationId: `human-${++sequence}`, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(model.project, edits) } })
    expect(result).toMatchObject({ status: 'applied' }); return read()
  }
  return { host, directory, read, call, observe, link, paths, human, sourcePath, documentId: snapshot.documentId }
}

async function executeResult(host: DocumentHostService, snapshot: DocumentSnapshot, definitionId: string) {
  const model = course(snapshot), implementation = model.project.definitions[definitionId]!.implementation
  if (implementation.kind !== 'source') throw new Error('Expected actual Source')
  const compiled = await host.compilation.compile(componentCompilationInput(model.project, implementation, model.resources))
  expect(compiled.status, JSON.stringify(compiled)).toBe('ready')
  if (compiled.status !== 'ready') throw new Error('Actual compiler did not produce usable output')
  const code = await transform(compiled.artifact.code, { format: 'cjs' }), module = { exports: {} as any }
  Function('module', 'exports', code.code)(module, module.exports)
  return module.exports.result(20)
}

it('links a real existing Source definition once; later shared edits update both consumers without COW forks, and null restores local resolution', async () => {
  const h = await fixture(); await h.observe()
  const before = await h.read(), original = course(before)
  expect(await h.link()).toMatchObject({ kind: 'read', data: { commit: 'committed', importChanges: { './model.js': h.paths.bench } } })
  const linked = await h.read(), linkedModel = course(linked)
  expect(linked.undoDepth).toBe(before.undoDepth + 1)
  expect(linkedModel.project.instances).toEqual(original.project.instances)
  expect(linkedModel.resources).toEqual(original.resources)
  expect(linkedModel.project.definitions.record!.implementation).toMatchObject({ moduleBindings: { './unrelated': 'unchanged', './model.js': 'bench' } })
  expect(await h.call('project.read', { path: h.paths.record })).toMatchObject({ kind: 'read', data: { imports: { './model.js': h.paths.bench } } })
  expect(await executeResult(h.host, linked, 'bench')).toEqual({ initial: 60, used: 20, remaining: 40 })
  expect(await executeResult(h.host, linked, 'record')).toEqual({ initial: 60, used: 20, remaining: 40 })
  const recordSource = linkedModel.project.definitions.record!.implementation
  expect([...liveSourceOwners(linkedModel.project, recordSource, linkedModel.resources).definitions]).toContain('bench')
  await h.call('project.read', { path: h.paths.model })
  expect(await h.call('project.apply', { path: h.paths.model, edits: [{ old: 'INITIAL = 60', new: 'INITIAL = 80' }] }))
    .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const changed = await h.read(), changedModel = course(changed)
  expect(Object.keys(changedModel.project.definitions)).toEqual(Object.keys(original.project.definitions))
  expect(changedModel.project.definitions.record!.implementation).toEqual(linkedModel.project.definitions.record!.implementation)
  expect(changedModel.project.definitions.bench!.implementation).toEqual(original.project.definitions.bench!.implementation)
  expect(await executeResult(h.host, changed, 'bench')).toEqual({ initial: 80, used: 20, remaining: 60 })
  expect(await executeResult(h.host, changed, 'record')).toEqual({ initial: 80, used: 20, remaining: 60 })
  const filename = path.join(h.directory, 'shared.glx'); await h.host.saveToPath(h.documentId, filename)
  const reopened = await new DocumentHostService(path.join(h.directory, 'cold')).open(filename)
  expect(reopened.model).toEqual(changed.model)
  expect(await executeResult(h.host, reopened, 'record')).toEqual({ initial: 80, used: 20, remaining: 60 })
  await h.observe(); expect(await h.link(null)).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  const unlinked = await h.read()
  expect(course(unlinked).project.definitions.record!.implementation).toMatchObject({ moduleBindings: { './unrelated': 'unchanged' } })
  expect(await executeResult(h.host, unlinked, 'record')).toEqual({ initial: 99, used: 20, remaining: 79 })
  expect(course(unlinked).resources).toEqual(changedModel.resources)
  // The entire unlink is a single formal History action.
  expect(await h.host.internalAPI.dispatch({ documentId: unlinked.documentId, epoch: unlinked.epoch, baseRevision: unlinked.revision,
    operationId: 'undo-unlink', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  expect(await executeResult(h.host, await h.read(), 'record')).toEqual({ initial: 80, used: 20, remaining: 60 })
}, 20_000)

it('requires real current source reads; a run acknowledgement followed by a directory listing cannot launder unread changed resource bytes', async () => {
  const h = await fixture()
  expect(await h.link()).toMatchObject({ kind: 'error', code: 'source-file-not-read' })
  await h.observe(); const before = await h.read(), model = course(before)
  const afterResource = await h.human([{ type: 'component.files.set', ownerId: 'bench-owner',
    expectedFiles: model.resources.components['bench-owner']!, files: { ...model.resources.components['bench-owner'], 'model.js': bytes(modelText(70)) } }])
  expect(afterResource.revision).toBe(before.revision + 1)
  expect(course(afterResource).project.revision).toBe(afterResource.revision)
  await h.call('project.read', { path: 'project.json' })
  expect(await h.call('project.apply', { path: 'project.json', edits: [{ old: 'Native teacher handoff', new: 'Own unrelated title' }] }))
    .toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  expect(await h.link()).toMatchObject({ kind: 'error', code: 'source-file-not-read' })
  // listScope/remember may retain an older fixed pagination capture. It must
  // not turn a summary into a content read of the newly changed dependency.
  let offset: number | undefined
  do {
    const result = await h.call('project.list', { ...(offset ? { offset } : {}), limit: 1000 })
    expect(result.kind).toBe('read'); offset = (result as any).data.nextOffset
  } while (offset !== undefined)
  expect(await h.link()).toMatchObject({ kind: 'error' })
  expect(course(await h.read()).project.definitions.record!.implementation).toEqual(model.project.definitions.record!.implementation)
  await h.observe(); expect(await h.link()).toMatchObject({ kind: 'read', data: { commit: 'committed' } })
  expect(await executeResult(h.host, await h.read(), 'record')).toEqual({ initial: 70, used: 20, remaining: 50 })
}, 15_000)

it('checks the captured revision inside the real Session after compilation when only dependency bytes change concurrently', async () => {
  const h = await fixture(); await h.observe()
  const originalCompile = h.host.compilation.compile.bind(h.host.compilation)
  let changed = false
  vi.spyOn(h.host.compilation, 'compile').mockImplementation(async (...args) => {
    const result = await originalCompile(...args)
    if (!changed) {
      changed = true; const model = course(await h.read())
      await h.human([{ type: 'component.files.set', ownerId: 'bench-owner', expectedFiles: model.resources.components['bench-owner']!,
        files: { ...model.resources.components['bench-owner'], 'model.js': bytes(modelText(90)) } }])
    }
    return result
  })
  const result = await h.link()
  expect(changed).toBe(true)
  expect(result).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
  const after = course(await h.read())
  expect(after.project.definitions.record!.implementation).toMatchObject({ moduleBindings: { './unrelated': 'unchanged' } })
  expect(new TextDecoder().decode(after.resources.components['bench-owner']!['model.js'])).toBe(modelText(90))
}, 15_000)

it('reports actual missing-export compiler diagnostics and rejects workspace leaf aliases and shared writes under an instance-only grant', async () => {
  const h = await fixture(); await h.observe()
  await h.call('project.read', { path: h.paths.model })
  expect(await h.link(h.paths.model)).toMatchObject({ kind: 'error', code: 'source-import-shared-entry-required' })
  expect(await h.link('components/other-document.view.js')).toMatchObject({ kind: 'error', code: 'source-file-not-read' })
  await h.call('project.read', { path: h.paths.wrong })
  const result = await h.link(h.paths.wrong)
  expect(result).toMatchObject({ kind: 'read', data: { usability: 'unusable', diagnostics: expect.arrayContaining([
    expect.objectContaining({ level: 'error', code: expect.stringContaining('component-') }),
  ]) } })
  // The pre-existing Source contract retains repairable author inputs. Never
  // call that a usable runtime, and never bypass the compiler in this test.
  const scoped = await fixture('record-only'); await scoped.observe()
  expect(await scoped.link()).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect((course(await scoped.read()).project.definitions.record!.implementation as Extract<ComponentImplementation, { kind: 'source' }>).moduleBindings)
    .toEqual({ './unrelated': 'unchanged' })
}, 15_000)
