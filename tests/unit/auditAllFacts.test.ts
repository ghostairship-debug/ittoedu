// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { mapMarkdownRange } from '../../src/core/tools/ToolTargets'
import { documentSourceEdits, mergedDocumentSource, planDocumentSourceMerge } from '../../src/shared/document/sourceMerge'
import type { DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

const md = (source: string): DocumentModel => ({ kind: 'markdown', source, resources: { assets: {}, components: {} } })
function memory() {
  const states: DurableDocumentState[] = []
  const port: DocumentPersistence = { async append(state) { states.push(structuredClone(state)) }, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('file')
    return { ...input.binding, version: `saved-${input.revision}` }
  } }
  return { states, port }
}
async function write(session: DocumentSession, source: string, id: string, group?: string) {
  const snapshot = session.read()
  return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: id,
    baseRevision: snapshot.revision, actor: 'human', ...(group ? { historyGroup: group } : {}),
    mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
}

describe('audit complete repair: source boundaries and durable operation facts', () => {
  it('CA229 retains an unchanged middle beyond the bounded diff distance', () => {
    const base = `${'甲'.repeat(160)} | TARGET | ${'乙'.repeat(160)}`
    const local = `${'丙'.repeat(160)} | TARGET | ${'丁'.repeat(160)}`
    const remote = base.replace('TARGET', '老师')
    const plan = planDocumentSourceMerge(base, local, remote)
    expect(plan.conflicts).toEqual([])
    expect(mergedDocumentSource(plan)).toBe(local.replace('TARGET', '老师'))
    expect(documentSourceEdits(base, local)).toHaveLength(2)
  })

  it('CA319 exposes complete emoji in a large manual conflict and preserves valid Unicode', () => {
    const plan = planDocumentSourceMerge(`😀${'甲'.repeat(350)}`, `😁${'乙'.repeat(350)}`, `😂${'丙'.repeat(350)}`)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]!.from).toBe(0)
    expect(plan.conflicts[0]!.local.startsWith('😁')).toBe(true)
    plan.conflicts[0]!.resolution = '老师手工合并的正文'
    const source = mergedDocumentSource(plan)
    expect(source.isWellFormed()).toBe(true)
    expect(() => createMarkdownDriver().validate(md(source))).not.toThrow()
  })

  it('CA241 maps separate changes around a target while keeping actual overlap and ambiguity rejected', () => {
    const range = { kind: 'markdown-range' as const, from: 9, to: 15 }
    expect(mapMarkdownRange('PREFIX | TARGET | SUFFIX', 'PREFIX+ | TARGET | SUFFIX+', range)).toEqual({ ...range, from: 10, to: 16 })
    expect(() => mapMarkdownRange('PREFIX | TARGET | SUFFIX', 'PREFIX+ | TAR!GET | SUFFIX+', range)).toThrow('重叠')
    expect(() => mapMarkdownRange('abab', 'ababab', { ...range, from: 2, to: 4 })).toThrow('不唯一')
    expect(() => mapMarkdownRange('abab', 'XabababY', { ...range, from: 2, to: 4 })).toThrow('不唯一')
    expect(() => mapMarkdownRange('aaaa', 'baaaaac', { ...range, from: 1, to: 2 })).toThrow('不唯一')
  })

  it('CA067 retains every actual commit pair while compressing Undo and through Undo/Redo and cold restore', async () => {
    const persistence = memory()
    const session = await DocumentSession.create({ documentId: 'facts', epoch: 'one', model: md('initial'),
      binding: { kind: 'untitled', suggestedName: 'facts.md' } }, createMarkdownDriver(), persistence.port)
    await write(session, 'first', 'first', 'typing'); await write(session, 'second', 'second', 'typing')
    expect(session.read().undoDepth).toBe(1)
    expect(session.committedChangesSince(0).map(change => [change.before, change.after].map(model => model && 'source' in model ? model.source : null)))
      .toEqual([['initial', 'first'], ['first', 'second']])
    for (const type of ['undo', 'redo'] as const) {
      const snapshot = session.read()
      await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: type, baseRevision: snapshot.revision,
        actor: 'human', mutation: { type } })
    }
    const restored = await DocumentSession.restore(persistence.states.at(-1)!, 'two', createMarkdownDriver(), persistence.port)
    expect(restored.committedChangesSince(2).map(change => [change.before, change.after].map(model => model && 'source' in model ? model.source : null)))
      .toEqual([['second', 'initial'], ['initial', 'second']])
  })

  it('CA172 restores the actual saved base after later edits', async () => {
    const persistence = memory(), session = await DocumentSession.create({ documentId: 'base', epoch: 'one', model: md('disk base'), saved: true,
      binding: { kind: 'file', path: '/A.md', version: 'original', bindingVersion: 1 } }, createMarkdownDriver(), persistence.port)
    await write(session, 'first save', 'first'); await session.save(); await write(session, 'later draft', 'second')
    const restored = await DocumentSession.restore(persistence.states.at(-1)!, 'two', createMarkdownDriver(), persistence.port)
    expect(restored.readSavedSource()).toBe('first save')
    expect(restored.read().dirty).toBe(true)
    const model = restored.read().model
    expect('source' in model && model.source).toBe('later draft')
  })

  it('resource capture uses the original frozen binding and leaves a newer local resource intact', async () => {
    const persistence = memory(); let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    persistence.port.prepareSaveModel = async ({ model, sourceBinding, targetBinding }) => {
      expect(sourceBinding.kind === 'file' && sourceBinding.path).toBe('/A.md')
      expect(targetBinding.kind === 'file' && targetBinding.path).toBe('/B.md')
      enter(); await gate
      return { ...model, resources: { assets: { 'image.png': new Uint8Array([2]) }, components: {} } }
    }
    const original = md('![图](image.png)'); original.resources.assets['image.png'] = new Uint8Array([1])
    const session = await DocumentSession.create({ documentId: 'resource', epoch: 'one', model: original, saved: true,
      binding: { kind: 'file', path: '/A.md', version: 'original', bindingVersion: 1 } }, createMarkdownDriver(), persistence.port)
    const saving = session.save({ kind: 'file', path: '/B.md', version: null, bindingVersion: 2 }); await entered
    const snapshot = session.read()
    await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'newer', baseRevision: snapshot.revision, actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '![图](image.png)\nnewer', resources: { assets: { 'image.png': new Uint8Array([3]) }, components: {} } } } })
    release(); await saving
    expect(session.read().model.resources.assets['image.png']).toEqual(new Uint8Array([3]))
    expect(session.readSavedModel()!.resources.assets['image.png']).toEqual(new Uint8Array([2]))
    expect(session.read().dirty).toBe(true)
  })

  it('a body edit during save retains each unchanged component file and adopts newly captured files', async () => {
    const persistence = memory(); let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    persistence.port.prepareSaveModel = async ({ model }) => { enter(); await gate; return { ...model, resources: { ...model.resources,
      components: { pkg: { ...model.resources.components.pkg, 'new.txt': new Uint8Array([2]) } } } } }
    const model = md('body'); model.resources.components.pkg = { 'old.txt': new Uint8Array([1]) }
    const session = await DocumentSession.create({ documentId: 'component', epoch: 'one', model, saved: true,
      binding: { kind: 'file', path: '/A.md', version: 'original', bindingVersion: 1 } }, createMarkdownDriver(), persistence.port)
    const saving = session.save(); await entered; await write(session, 'body newer', 'body'); release(); await saving
    expect(session.read().model.resources.components.pkg).toEqual({ 'old.txt': new Uint8Array([1]), 'new.txt': new Uint8Array([2]) })
    expect(session.read().dirty).toBe(true)
  })

  it('unknown save acknowledgement adopts the actual proven disk model, including prepared resources', async () => {
    const persistence = memory(); let saved: DocumentModel | undefined, fail = true
    persistence.port.prepareSaveModel = async ({ model }) => ({ ...model, resources: { assets: { 'image.png': new Uint8Array([2]) }, components: {} } })
    const append = persistence.port.append
    persistence.port.append = async state => { if (fail && state.sequence > 0 && state.binding.kind === 'file' && state.binding.path === '/B.md') {
      fail = false; throw new Error('ACK append failed')
    }; await append(state) }
    persistence.port.save = async input => { saved = structuredClone(input.model); if (input.binding.kind !== 'file') throw new Error('file'); return { ...input.binding, version: 'proven' } }
    const sourceBinding = { kind: 'file' as const, path: '/A.md', version: 'original', bindingVersion: 1 }
    const targetBinding = { ...sourceBinding, path: '/B.md', version: 'proven', bindingVersion: 2 }
    const session = await DocumentSession.create({ documentId: 'proof', epoch: 'one', model: md('![图](image.png)'), saved: true, binding: sourceBinding }, createMarkdownDriver(), persistence.port)
    await expect(session.save(targetBinding)).rejects.toThrow('ACK append failed')
    await session.withFileLease(lease => lease.acknowledgeSave({ identity: { runId: 'run', operationId: 'save', requestDigest: 'digest' },
      documentId: session.documentId, epoch: 'one', savedRevision: 0, sourceBinding, binding: targetBinding, savedModel: saved }))
    expect(session.read().model.resources.assets['image.png']).toEqual(new Uint8Array([2]))
    expect(session.readSavedModel()!.resources.assets['image.png']).toEqual(new Uint8Array([2]))
    expect(session.read().dirty).toBe(false)
  })

  it('CA276 publishes the durable external before/after commit before the changed view event', async () => {
    const persistence = memory(), session = await DocumentSession.create({ documentId: 'external', epoch: 'one', model: md('AOLD\nBOLD'), saved: true,
      binding: { kind: 'file', path: '/A.md', version: 'original', bindingVersion: 1 } }, createMarkdownDriver(), persistence.port)
    const events: string[] = []
    session.subscribeCommits(commit => { expect(commit.operation.mutation.type).toBe('reconcile');
      expect(commit.before).toMatchObject({ source: 'AOLD\nBOLD' }); expect(commit.after).toMatchObject({ source: 'AOLD\nBNEW' }); events.push('commit') })
    session.subscribe(() => events.push('changed'))
    await session.reconcileFile({ epoch: 'one', baseRevision: 0, bindingVersion: 1 }, async () => ({ model: md('AOLD\nBNEW'), version: 'external', matchesDisk: true }))
    expect(events).toEqual(['commit', 'changed'])
    expect(session.committedChangesSince(0)[0]!.after).toMatchObject({ source: 'AOLD\nBNEW' })
  })
})
