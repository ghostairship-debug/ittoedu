// @vitest-environment node
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { AttachmentExtractor } from '../../src/shared/workbench/attachments'
import { normalizeDesktopError, DesktopOperationError } from '../../src/main/errors'
import { AttachmentError, AttachmentService, type AttachmentServiceOptions } from '../../src/main/workbench/attachments/AttachmentService'
import { AttachmentsDesktopService } from '../../src/main/workbench/attachments/attachmentsDesktopService'
import { attachmentOperationError } from '../../src/main/workbench/attachments/attachmentOperationErrors'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-attachment-failure-'))
  roots.push(root)
  return { root, directory: path.join(root, 'managed'), service: new AttachmentService({ directory: path.join(root, 'managed') }) }
}
const fallback = { code: 'ATTACHMENT_FAILED', title: '附件操作未完成', message: '附件未能处理，请查看具体原因。', suggestion: '已有草稿和原件快照已保留。' }
function uiError(error: unknown) { return normalizeDesktopError(attachmentOperationError(error), fallback) }
function windowFor(id: number): BrowserWindow {
  return { webContents: Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) } as unknown as BrowserWindow
}

describe('attachment failure recovery', () => {
  it('classifies damaged image pixels and malformed or missing disk snapshots without affecting a good snapshot', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { directory, service } = await fixture()
    const goodBytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer()
    const good = await service.receiveBytes({ name: 'good.png', bytes: goodBytes, source: { kind: 'paste' } })
    const damaged = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('invalid compressed pixels')])
    let decodeError: unknown
    try { await service.receiveBytes({ name: 'bad.png', bytes: damaged, source: { kind: 'paste' } }) } catch (error) { decodeError = error }
    expect(decodeError).toMatchObject({ code: 'invalid-image', cause: expect.any(Error) })
    expect(uiError(decodeError)).toMatchObject({ code: 'attachment-invalid-image', message: expect.stringContaining('可解码'), suggestion: expect.stringContaining('重新导出') })

    const badId = randomUUID(), badFile = path.join(directory, 'snapshots', `${badId}.json`)
    await fs.writeFile(badFile, '{"privatePath":"C:\\internal\\stack",')
    let parseError: unknown
    try { await service.readSnapshot(badId) } catch (error) { parseError = error }
    expect(parseError).toMatchObject({ code: 'corrupt-snapshot', cause: expect.any(SyntaxError) })
    const schemaId = randomUUID()
    await fs.writeFile(path.join(directory, 'snapshots', `${schemaId}.json`), JSON.stringify({ schemaVersion: 1, id: schemaId }))
    await expect(service.readSnapshot(schemaId)).rejects.toMatchObject({ code: 'corrupt-snapshot', cause: expect.any(Error) })
    expect(uiError(parseError)).toMatchObject({ code: 'attachment-corrupt-snapshot', suggestion: expect.stringContaining('重新添加') })
    let missing: unknown
    try { await service.readSnapshot(randomUUID()) } catch (error) { missing = error }
    expect(uiError(missing).code).toBe('attachment-attachment-missing')
    expect(await service.readSnapshot(good.id)).toEqual(good)
    expect(Buffer.from((await service.readRepresentation(good.id, 'original-image')).bytes)).toEqual(goodBytes)
  })

  it('retries the same immutable snapshot and request after cancellation or timeout without broadening exact file grants', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { root, directory } = await fixture()
    const desktop = new AttachmentsDesktopService(directory)
    const owner = windowFor(11), other = windowFor(12), authorizationId = randomUUID(), requestId = randomUUID()
    const source = path.join(root, 'source.pdf')
    await fs.writeFile(source, '%PDF-1.7\nfixture')
    const grants = (desktop as unknown as { grants: Map<string, { path: string; kind: 'file'; owner: number; expires: number }> }).grants
    grants.set(authorizationId, { path: source, kind: 'file', owner: 11, expires: Date.now() + 60_000 })
    const original = await desktop.operate({ type: 'receive-granted', authorizationId, requestId: randomUUID() }, owner) as Awaited<ReturnType<AttachmentService['readSnapshot']>>
    expect(original.source.authorizationId).toBe(authorizationId)
    await expect(desktop.operate({ type: 'receive-granted', authorizationId, requestId: randomUUID() }, other)).rejects.toMatchObject({ code: 'attachment-path-not-authorized' })
    await expect(desktop.operate({ type: 'receive-granted', authorizationId: randomUUID(), requestId: randomUUID() }, owner)).rejects.toMatchObject({ code: 'attachment-path-not-authorized' })

    let attempts = 0, started!: () => void
    const extracting = new Promise<void>(resolve => { started = resolve })
    const extractor: AttachmentExtractor = { extract: async (_input, options) => {
      attempts++
      if (attempts === 1) {
        started()
        return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }))
      }
      if (attempts === 2) throw new AttachmentError('extraction-timeout', 'fixture timeout')
      return { material: { version: 1, extractorVersion: 'fixture', format: 'pdf', fragments: [{ id: 'page-1', kind: 'text', locator: { part: 'page:1', page: 1 }, text: 'recovered text' }], assets: [], gaps: [] }, totalPages: 1, selectedPages: { from: 1, to: 1 }, pageImages: [] }
    } }
    ;(desktop.attachments as unknown as { options: AttachmentServiceOptions }).options.extractor = extractor
    const extract = { type: 'extract', attachmentId: original.id, requestId }
    const cancelled = desktop.operate(extract, owner)
    await extracting
    await desktop.operate({ type: 'cancel', requestId }, owner)
    await expect(cancelled).rejects.toMatchObject({ code: 'attachment-operation-cancelled' })
    expect(await desktop.attachments.readSnapshot(original.id)).toEqual(original)
    await expect(desktop.operate(extract, owner)).rejects.toMatchObject({ code: 'attachment-extraction-timeout' })
    expect(await desktop.attachments.readSnapshot(original.id)).toEqual(original)
    const derived = await desktop.operate(extract, owner) as Awaited<ReturnType<AttachmentService['readSnapshot']>>
    expect(derived).toMatchObject({ derivedFrom: original.id, digest: original.digest })
    expect(new TextDecoder().decode((await desktop.attachments.readRepresentation(derived.id, 'extracted-1')).bytes)).toBe('recovered text')
    expect(await desktop.attachments.readSnapshot(original.id)).toEqual(original)
    expect(attempts).toBe(3)

    const cancelledBeforeStart = randomUUID()
    await desktop.operate({ type: 'cancel', requestId: cancelledBeforeStart }, owner)
    await expect(desktop.operate({ ...extract, requestId: cancelledBeforeStart }, owner)).rejects.toMatchObject({ code: 'attachment-operation-cancelled' })
    expect((await desktop.operate({ ...extract, requestId: cancelledBeforeStart }, owner) as typeof derived).derivedFrom).toBe(original.id)
  })

  it('keeps unknown internal paths and stacks out of the normalized UI response', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = 'C:\\internal\\users\\private\\attachment-worker.js'
    const unknown = new Error(`Unexpected failure at ${secret}`)
    unknown.stack = `Error: ${unknown.message}\n at ${secret}:42:1`
    expect(attachmentOperationError(unknown)).toBe(unknown)
    expect(normalizeDesktopError(attachmentOperationError(unknown), fallback)).toEqual(fallback)
    expect(JSON.stringify(uiError(unknown))).not.toContain(secret)
    const known = attachmentOperationError(new AttachmentError('invalid-image', 'decode failed', { cause: unknown }))
    expect(known).toBeInstanceOf(DesktopOperationError)
    expect((known as DesktopOperationError).cause).toBeInstanceOf(AttachmentError)
    expect(JSON.stringify(normalizeDesktopError(known, fallback))).not.toContain(secret)
  })
})
