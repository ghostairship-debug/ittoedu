// @vitest-environment node
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { documentDigest, documentOperationDigest } from '../../src/core/documents/documentDigest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { DocumentDriver, DocumentModel, DocumentOperation, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

async function fixture(model: DocumentModel = { kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, driver: DocumentDriver = createMarkdownDriver()) {
  const states: DurableDocumentState[] = []
  const persistence: DocumentPersistence = { async append(state) { states.push(structuredClone(state)) }, async save(input) { if (input.binding.kind !== 'file') throw new Error('file binding required'); return input.binding } }
  const session = await DocumentSession.create({ documentId: 'digest', epoch: 'first', model, binding: { kind: 'untitled', suggestedName: 'digest' } }, driver, persistence)
  const operation = (id: string, bytes = new Uint8Array([1, 2, 3])): DocumentOperation => ({ documentId: session.documentId, epoch: 'first', baseRevision: 0,
    operationId: id, actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: 'changed', resources: { assets: { 'sample.bin': bytes }, components: {} } } } })
  return { session, states, persistence, driver, operation }
}

function envelope(operation: DocumentOperation, requestDigest: string) {
  return { documentId: operation.documentId, operationId: operation.operationId, actor: operation.actor, runId: operation.runId, requestDigest }
}

describe('versioned Session operation digest', () => {
  it('hashes only the actual typed byte view without materializing numeric arrays, including cross-realm views', () => {
    const backing = new Uint8Array(8 * 1024 * 1024 + 2); backing.fill(23); backing[0] = 91; backing[backing.length - 1] = 92
    const view = backing.subarray(1, -1), from = vi.spyOn(Array, 'from').mockImplementation(() => { throw new Error('numeric byte copy') })
    try {
      const digest = documentOperationDigest({ bytes: view })
      expect(digest).toMatch(/^op-v2:[a-f0-9]{64}$/)
      expect(documentOperationDigest({ bytes: new Uint8Array(view) })).toBe(digest)
      expect(documentOperationDigest({ bytes: backing })).not.toBe(digest)
      expect(documentOperationDigest({ bytes: vm.runInNewContext('new Uint8Array([1,2,3])') })).toBe(documentOperationDigest({ bytes: new Uint8Array([1, 2, 3]) }))
      expect(view.byteLength).toBe(8 * 1024 * 1024)
    } finally { from.mockRestore() }
  })

  it('preserves key ordering, type distinctions and JSON escaped string semantics while leaving public legacy digests unchanged', () => {
    const value = { bytes: new Uint8Array([1, 255]), text: '\uD800', missing: undefined }
    const legacyJson = '["object",[["bytes",["bytes",[1,255]]],["missing",["undefined",null]],["text",["string","\\ud800"]]]]'
    expect(documentDigest(value)).toBe(createHash('sha256').update(legacyJson).digest('hex'))
    expect(documentOperationDigest(value)).toBe(documentOperationDigest({ missing: undefined, text: '\uD800', bytes: new Uint8Array([1, 255]) }))
    expect(documentOperationDigest({ value: new Uint8Array([1, 2]) })).not.toBe(documentOperationDigest({ value: { bytes: [1, 2] } }))
    expect(documentOperationDigest({ value: '1' })).not.toBe(documentOperationDigest({ value: 1 }))
    expect(() => documentOperationDigest({ value: Infinity })).toThrow('无效数字')
  })

  it('recovers new versioned receipts and rejects changed bytes under the same operation ID', async () => {
    const f = await fixture(), request = f.operation('new')
    const result = await f.session.execute(request)
    expect(result.status).toBe('applied')
    expect(f.states.at(-1)!.operations.at(-1)!.digest).toBe(documentOperationDigest(request))
    const restored = await DocumentSession.restore(f.states.at(-1)!, 'second', f.driver, f.persistence)
    expect(await restored.execute(request)).toEqual(result)
    expect(await restored.execute(f.operation('new', new Uint8Array([1, 2, 4])))).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(restored.read().revision).toBe(1)
  })

  it('replays legacy direct receipts without migrating them or accepting a changed request', async () => {
    const f = await fixture(), request = f.operation('legacy-direct'), result = await f.session.execute(request)
    const old = structuredClone(f.states.at(-1)!); old.operations.at(-1)!.digest = documentDigest(request)
    const restored = await DocumentSession.restore(old, 'second', f.driver, f.persistence)
    expect(await restored.execute(request)).toEqual(result)
    expect(await restored.execute(f.operation('legacy-direct', new Uint8Array([1, 2, 4])))).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(old.operations.at(-1)!.digest).toBe(documentDigest(request))
  })

  it('replays the exact old Host component envelope and rejects changed component content', async () => {
    const project = createBlankCourseProjectV10('old host'), driver = new CourseV10Driver()
    const f = await fixture({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, driver)
    const command = captureComponentOperation(project, [{ type: 'instance.patch', instanceId: project.rootIds[0], patch: { name: 'renamed' } }])
    const request: DocumentOperation = { documentId: f.session.documentId, epoch: 'first', baseRevision: 0, operationId: 'legacy-host', actor: 'human', mutation: { type: 'command', command } }
    const result = await f.session.execute(request); expect(result.status).toBe('applied')
    const old = structuredClone(f.states.at(-1)!); old.operations.at(-1)!.digest = documentDigest(envelope(request, documentDigest(request)))
    const restored = await DocumentSession.restore(old, 'second', driver, f.persistence)
    expect(await restored.execute(request, { rebaseComponentExpectations: true })).toEqual(result)
    const changed = structuredClone(request)
    if (changed.mutation.type !== 'command' || changed.mutation.command.type !== 'component-platform.apply') throw new Error('component command')
    changed.mutation.command.edits = [{ type: 'instance.patch', instanceId: project.rootIds[0], patch: { name: 'different' } }]
    expect(await restored.execute(changed, { rebaseComponentExpectations: true })).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(restored.read().revision).toBe(1)
  })

  it('keeps explicit trusted request envelope and lookupRequest unchanged across recovery', async () => {
    const f = await fixture(), request = { ...f.operation('trusted'), runId: 'run', requestDigest: 'frozen-tool-request' }
    const result = await f.session.execute(request)
    expect(f.states.at(-1)!.operations.at(-1)!.digest).toBe(documentDigest(envelope(request, request.requestDigest)))
    const restored = await DocumentSession.restore(f.states.at(-1)!, 'second', f.driver, f.persistence)
    expect(restored.lookupRequest(request)).toEqual(result)
    expect(restored.lookupRequest({ ...request, requestDigest: 'changed-tool-request' })).toMatchObject({ status: 'conflict', code: 'operation-payload-mismatch' })
    expect(await restored.execute({ ...request, epoch: 'second', baseRevision: 1 })).toEqual(result)
  })
})
