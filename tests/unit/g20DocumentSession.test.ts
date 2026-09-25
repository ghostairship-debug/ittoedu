// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import type { DocumentModel, DocumentOperation, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

function memoryPersistence() {
  const states: DurableDocumentState[] = []
  let fail = false
  const port: DocumentPersistence = {
    async append(state) { if (fail) throw new Error('disk full'); states.push(structuredClone(state)) },
    async save(input) {
      if (input.binding.kind !== 'file') throw new Error('missing file')
      return { ...input.binding, version: `saved-${input.revision}` }
    },
  }
  return { port, states, failNext(value: boolean) { fail = value } }
}
function md(source = ''): DocumentModel { return { kind: 'markdown', source, resources: { assets: {}, components: {} } } }
function operation(session: DocumentSession, id: string, source: string, runId?: string): DocumentOperation {
  const snapshot = session.read()
  return { documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: id, actor: runId ? 'agent' : 'human', ...(runId ? { runId } : {}),
    mutation: { type: 'command', command: { type: 'markdown.replace', source } } }
}
function history(session: DocumentSession, id: string, type: 'undo' | 'redo'): DocumentOperation {
  return { ...operation(session, id, ''), mutation: { type } }
}
async function newMarkdown(persistence = memoryPersistence()) {
  const session = await DocumentSession.create({ documentId: 'md', epoch: 'epoch-1', model: md(), binding: { kind: 'untitled', suggestedName: '未保存.md' } }, createMarkdownDriver(), persistence.port)
  return { session, persistence }
}

describe('G20 S02/S03 authoritative document session', () => {
  it('a plain save queued behind Save As resolves its actual binding and keeps exactly one writer', async () => {
    let id = 0, release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const entered = new Promise<void>(resolve => { started = resolve })
    const persistence = memoryPersistence()
    let first = true
    const registry = new DocumentRegistry({ drivers: [createMarkdownDriver()], createId: () => `save-order-${++id}`, bindingKey: binding => binding.path,
      persistence: { ...persistence.port, async save(input) {
        if (input.binding.kind !== 'file') throw new Error('binding')
        if (first) { first = false; started(); await gate }
        return { ...input.binding, version: 'saved' }
      } } })
    const initial = { kind: 'file' as const, path: '/A.md', version: 'original', bindingVersion: 1 }
    const document = await registry.open(initial, async () => md('draft'))
    const saveAs = registry.save(document.documentId, { ...initial, path: '/B.md', version: null })
    await entered
    const save = registry.save(document.documentId)
    release()
    await Promise.all([saveAs, save])
    let loaded = false
    expect(await registry.open({ ...initial, path: '/B.md' }, async () => { loaded = true; return md('duplicate') })).toBe(document)
    expect(loaded).toBe(false)
    expect(registry.list()).toHaveLength(1)
  })

  it('file binding barrier redirects a concurrent save/open without blocking another document or resetting History', async () => {
    const saved: string[] = []
    let id = 0
    const persistence = memoryPersistence()
    const registry = new DocumentRegistry({ drivers: [createMarkdownDriver()], createId: () => `file-${++id}`, bindingKey: binding => binding.path,
      persistence: { ...persistence.port, async save(input) { if (input.binding.kind !== 'file') throw new Error('path'); saved.push(input.binding.path); return input.binding } } })
    const oldBinding = { kind: 'file' as const, path: '/old.md', version: 'disk', bindingVersion: 1 }
    const newBinding = { ...oldBinding, path: '/new.md', bindingVersion: 2 }
    const document = await registry.open(oldBinding, async () => md('base'))
    const other = await registry.open({ ...oldBinding, path: '/other.md' }, async () => md('other'))
    await document.execute(operation(document, 'draft', 'dirty draft'))
    let enter!: () => void, complete!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const ready = new Promise<void>(resolve => { complete = resolve })
    const move = registry.withFileBindings([document.documentId], [newBinding], async leases => {
      enter(); await ready
      await leases.get(document.documentId)!.rebind(newBinding)
    })
    await entered
    let loaded = false
    const open = registry.open(newBinding, async () => { loaded = true; return md('wrong second writer') })
    const save = registry.save(document.documentId)
    await registry.save(other.documentId)
    expect(saved).toEqual(['/other.md'])
    complete()
    await move
    expect(await open).toBe(document)
    expect(loaded).toBe(false)
    await save
    expect(saved).toEqual(['/other.md', '/new.md'])
    expect(document.read()).toMatchObject({ revision: 1, undoDepth: 1, dirty: false, binding: newBinding, model: { source: 'dirty draft' } })
    await document.execute(history(document, 'undo-after-move', 'undo'))
    expect(document.read()).toMatchObject({ binding: newBinding, model: { source: 'base' } })
  })

  it('a failed physical file action releases the binding barrier and keeps the original binding', async () => {
    let id = 0
    const persistence = memoryPersistence()
    const registry = new DocumentRegistry({ drivers: [createMarkdownDriver()], createId: () => `failure-${++id}`, bindingKey: binding => binding.path, persistence: persistence.port })
    const old = { kind: 'file' as const, path: '/source.md', version: 'disk', bindingVersion: 1 }
    const document = await registry.open(old, async () => md('unchanged'))
    await expect(registry.withFileBindings([document.documentId], [{ ...old, path: '/target.md' }], async () => { throw new Error('access denied') })).rejects.toThrow('access denied')
    expect((await registry.save(document.documentId)).binding).toMatchObject({ path: '/source.md' })
    expect(await registry.open(old, async () => md('wrong'))).toBe(document)
  })

  it('S03-T01 commits a replayed operation once and rejects another payload under the same ID', async () => {
    const { session, persistence } = await newMarkdown()
    const change = operation(session, 'op-1', '中文 😀\r\n')
    const result = await session.execute(change)
    expect(result.status).toBe('applied')
    expect(await session.execute(change)).toEqual(result)
    expect(session.lookupOperation('op-1')).toEqual(result)
    expect(await session.execute({ ...change, mutation: { type: 'command', command: { type: 'markdown.replace', source: 'different' } } })).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(session.read()).toMatchObject({ revision: 1, undoDepth: 1, model: { source: '中文 😀\r\n' } })
    expect(persistence.states).toHaveLength(2)
  })

  it('S02-T05 rejects stale manual input and isolates mutable callers and failing subscribers', async () => {
    const { session } = await newMarkdown()
    session.subscribe(() => { throw new Error('renderer disconnected') })
    const first = operation(session, 'human-1', 'first')
    const second = operation(session, 'human-2', 'unsent draft')
    const pending = session.execute(first)
    first.mutation = { type: 'command', command: { type: 'markdown.replace', source: 'mutated after enqueue' } }
    expect((await pending).status).toBe('applied')
    expect(await session.execute(second)).toMatchObject({ status: 'conflict', code: 'stale-revision' })
    const view = session.read()
    if (view.model.kind === 'markdown') view.model.source = 'view mutation'
    expect(session.read().model).toMatchObject({ source: 'first' })
    expect(second.mutation).toMatchObject({ command: { source: 'unsent draft' } })
  })

  it('keeps the original trusted tool request identity across planning revisions and recovery', async () => {
    const { session, persistence } = await newMarkdown()
    const request = { ...operation(session, 'tool-call-1', 'once', 'run-1'), requestDigest: 'host-digest-of-frozen-call' }
    const receipt = await session.execute(request)
    await session.execute(operation(session, 'human-after', 'once plus human'))
    const restored = await DocumentSession.restore(persistence.states.at(-1)!, 'new-epoch', createMarkdownDriver(), persistence.port)
    expect(restored.lookupRequest(request)).toEqual(receipt)
    expect(restored.lookupRequest({ ...request, requestDigest: 'different-tool-arguments' })).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(await restored.execute({ ...request, epoch: 'new-epoch', baseRevision: restored.read().revision })).toEqual(receipt)
    expect(restored.read()).toMatchObject({ revision: 2, undoDepth: 2, model: { source: 'once plus human' } })
  })

  it('S03-T04 persists a stop barrier, preserves earlier writes and rejects late writes after recovery', async () => {
    const { session, persistence } = await newMarkdown()
    await session.execute(operation(session, 'first', 'committed', 'run-1'))
    await session.stopRun('run-1')
    expect(await session.execute(operation(session, 'late', 'must not appear', 'run-1'))).toMatchObject({ status: 'cancelled', code: 'run-stopped' })
    const recovered = await DocumentSession.restore(persistence.states.at(-1)!, 'epoch-2', createMarkdownDriver(), persistence.port)
    expect(await recovered.execute(operation(recovered, 'later', 'still stopped', 'run-1'))).toMatchObject({ status: 'cancelled' })
    expect(recovered.read().model).toMatchObject({ source: 'committed' })
    expect(recovered.read().undoDepth).toBe(1)
    expect(recovered.lookupOperation('first')).toMatchObject({ status: 'applied', revision: 1 })
  })

  it('S03 failure keeps content, resources and history untouched until durable append succeeds', async () => {
    const { session, persistence } = await newMarkdown()
    const change = operation(session, 'with-image', '![image](assets/a.png)')
    if (change.mutation.type === 'command' && change.mutation.command.type === 'markdown.replace') change.mutation.command.resources = { assets: { 'assets/a.png': new Uint8Array([1, 2, 3]) }, components: {} }
    persistence.failNext(true)
    expect(await session.execute(change)).toMatchObject({ status: 'failed', code: 'recovery-write-failed' })
    expect(session.read()).toMatchObject({ revision: 0, undoDepth: 0, model: { source: '', resources: { assets: {} } } })
    persistence.failNext(false)
    expect((await session.execute(change)).status).toBe('applied')
    await session.execute(history(session, 'undo-image', 'undo'))
    expect(session.read().model.resources.assets).toEqual({})
    await session.execute(history(session, 'redo-image', 'redo'))
    expect(session.read().model.resources.assets['assets/a.png']).toEqual(new Uint8Array([1, 2, 3]))
    expect(session.read().revision).toBe(3)
  })

  it('S03-T05 saves captured r while later r+1 remains dirty', async () => {
    const persistence = memoryPersistence()
    let written: Parameters<DocumentPersistence['save']>[0] | undefined
    let release!: () => void
    let started!: () => void
    const start = new Promise<void>(resolve => { started = resolve })
    const finish = new Promise<void>(resolve => { release = resolve })
    persistence.port.save = async input => {
      written = structuredClone(input); started(); await finish
      return { kind: 'file', path: 'saved.md', bindingVersion: 1, version: 'disk-r1' }
    }
    const { session } = await newMarkdown(persistence)
    await session.execute(operation(session, 'r1', 'on disk'))
    const saving = session.save({ kind: 'file', path: 'saved.md', bindingVersion: 1, version: null })
    await start
    await session.execute(operation(session, 'r2', 'newer input'))
    release()
    expect(await saving).toMatchObject({ revision: 2, dirty: true, saving: false, model: { source: 'newer input' } })
    expect(new TextDecoder().decode(written!.bytes)).toBe('on disk')
    expect(persistence.states.at(-1)!.savedRevision).toBe(1)
  })

  it('S02-T01 isolates two V9 documents and an untitled Markdown document with separate history/resources', async () => {
    const persistence = memoryPersistence()
    let next = 0
    const course = createCourseV9Driver()
    const registry = new DocumentRegistry({ persistence: persistence.port, drivers: [createMarkdownDriver(), course], createId: () => `id-${++next}`, bindingKey: binding => binding.path.toLowerCase() })
    const fixture = await course.load(new Uint8Array(readFileSync(resolve('tests/fixtures/course-project-v9/multi-asset.h5lesson'))))
    const a = await registry.create(fixture, 'A.h5lesson')
    const b = await registry.create(fixture, 'B.h5lesson')
    const c = await registry.create(md(), '新建.md')
    const original = a.read()
    for (const [session, title] of [[a, 'A edited'], [b, 'B edited']] as const) {
      const snapshot = session.read()
      if (snapshot.model.kind !== 'course-v9') throw new Error('wrong fixture')
      snapshot.model.project.title = title
      const result = await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: title, actor: 'human', baseRevision: snapshot.revision, mutation: { type: 'command', command: { type: 'course.replace', project: snapshot.model.project } } })
      expect(result.status).toBe('applied')
    }
    await c.execute(operation(c, 'md-edit', 'unsaved but readable'))
    await a.execute(history(a, 'undo-a', 'undo'))
    expect(a.read().model).toMatchObject({ project: { title: fixture.kind === 'course-v9' ? fixture.project.title : '' } })
    expect(a.read().model.resources).toEqual(original.model.resources)
    expect(b.read().model).toMatchObject({ project: { title: 'B edited' } })
    expect((await c.drain()).model).toMatchObject({ source: 'unsaved but readable' })
    expect(new Set(registry.list().map(value => value.documentId)).size).toBe(3)
    expect(a.read().revision).toBe(original.revision + 2)
  })

  it('S02 same-file concurrent opens reuse one writer and closing dirty content requires an explicit decision', async () => {
    const persistence = memoryPersistence()
    let next = 0, loads = 0
    const registry = new DocumentRegistry({ persistence: persistence.port, drivers: [createMarkdownDriver()], createId: () => `id-${++next}`, bindingKey: binding => binding.path.toLowerCase() })
    const binding = { kind: 'file' as const, path: 'C:/课程/笔记.md', bindingVersion: 1, version: 'initial' }
    const [a, b] = await Promise.all([registry.open(binding, async () => { loads++; return md('disk') }), registry.open({ ...binding, path: 'c:/课程/笔记.md' }, async () => { loads++; return md('wrong') })])
    expect(a).toBe(b); expect(loads).toBe(1)
    await a.execute(operation(a, 'edit', 'dirty'))
    await expect(registry.close(a.documentId)).rejects.toThrow('未保存')
    expect(registry.list()).toHaveLength(1)
    await registry.close(a.documentId, { discardDirty: true })
    expect(registry.list()).toHaveLength(0)
  })

  it('S02 close barrier cannot discard an edit committed while a clean document is closing', async () => {
    const persistence = memoryPersistence()
    let id = 0
    const registry = new DocumentRegistry({ persistence: persistence.port, drivers: [createMarkdownDriver()], createId: () => `id-${++id}`, bindingKey: binding => binding.path })
    const session = await registry.open({ kind: 'file', path: 'clean.md', bindingVersion: 1, version: 'v1' }, async () => md('clean'))
    const closing = registry.close(session.documentId)
    const writing = session.execute(operation(session, 'racing-input', 'must survive'))
    const result = await writing
    if (result.status === 'applied') {
      await expect(closing).rejects.toThrow('未保存')
      expect(registry.get(session.documentId).read().model).toMatchObject({ source: 'must survive' })
    } else {
      await closing
      expect(result).toMatchObject({ status: 'conflict', code: 'stale-epoch' })
    }
  })

  it('S02 concurrent Save As removes intermediate bindings instead of opening the wrong document', async () => {
    const persistence = memoryPersistence()
    let id = 0, loads = 0
    const registry = new DocumentRegistry({ persistence: persistence.port, drivers: [createMarkdownDriver()], createId: () => `id-${++id}`, bindingKey: binding => binding.path })
    const file = (path: string) => ({ kind: 'file' as const, path, bindingVersion: 1, version: null })
    const a = await registry.open(file('A.md'), async () => md('A'))
    await Promise.all([registry.save(a.documentId, file('B.md')), registry.save(a.documentId, file('C.md'))])
    expect(a.read().binding).toMatchObject({ path: 'C.md' })
    const b = await registry.open(file('B.md'), async () => { loads++; return md('B on disk') })
    expect(loads).toBe(1)
    expect(b.documentId).not.toBe(a.documentId)
    expect(b.read().model).toMatchObject({ source: 'B on disk' })
  })

  it('S02 restore reserves file identity before asynchronous journal IO', async () => {
    const persistence = memoryPersistence()
    const initial = await DocumentSession.create({ documentId: 'restored-id', epoch: 'old', model: md('recovery'), binding: { kind: 'file', path: 'A.md', bindingVersion: 1, version: 'v1' } }, createMarkdownDriver(), persistence.port)
    const state = persistence.states.at(-1)!
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const append = persistence.port.append
    persistence.port.append = async next => { await gate; await append(next) }
    let id = 0, loads = 0
    const registry = new DocumentRegistry({ persistence: persistence.port, drivers: [createMarkdownDriver()], createId: () => `epoch-${++id}`, bindingKey: binding => binding.path })
    const restoring = registry.restore(state)
    const opening = registry.open(state.binding as Extract<typeof state.binding, { kind: 'file' }>, async () => { loads++; return md('disk') })
    release()
    const [a, b] = await Promise.all([restoring, opening])
    expect(a).toBe(b); expect(a.documentId).toBe(initial.documentId)
    expect(loads).toBe(0); expect(registry.list()).toHaveLength(1)
  })
})
