// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { nestedFlowSizingFixture } from '../helpers/nestedFlowSizingFixture'
import type { DocumentOperationResult } from '../../src/shared/workbench/document'

const dispose: Array<() => void> = []
afterEach(() => { dispose.splice(0).forEach(work => work()); vi.restoreAllMocks() })
async function fixture() {
  const h = await createV10StoreHost(nestedFlowSizingFixture())
  dispose.push(() => h.bridge.dispose())
  return h
}

it('can query the original deletion after its control vanished without replaying or changing the foreground document', async () => {
  const h = await fixture(), dispatch = h.api.dispatch.bind(h.api)
  const sent = vi.spyOn(h.api, 'dispatch').mockImplementationOnce(async (...args) => {
    await dispatch(...args); throw new Error('ACK lost after deletion')
  })
  expect(h.bridge.captureUnconfirmedInput()).toBeNull()
  const failure = await h.bridge.edit([{ type: 'instance.remove', instanceId: 'after' }]).catch(error => error)
  expect(h.model().project.instances.after).toBeUndefined()
  const target = h.bridge.captureUnconfirmedInput()!
  expect(target).toEqual({ documentId: h.first.documentId, epoch: h.first.read().epoch, operationId: failure.operationId })
  const other = await h.api.create({ kind: 'course-v10', project: nestedFlowSizingFixture(), resources: { assets: {}, components: {} } }, 'other.glx')
  await h.bridge.activate(other.documentId)
  const foreground = h.bridge.read().activation
  const lookup = vi.spyOn(h.api, 'lookup')
  const outcome = await h.bridge.queryUnconfirmedInput(target)
  expect(outcome).toMatchObject({ status: 'settled', result: { status: 'applied', operationId: target.operationId, revision: 1 } })
  expect(lookup).toHaveBeenCalledWith(target.documentId, target.operationId)
  expect(sent).toHaveBeenCalledTimes(1)
  expect(h.bridge.read()).toMatchObject({ activeDocumentId: other.documentId, activation: foreground, pending: 0, error: null })
  expect(h.first.read().undoDepth).toBe(1)
  expect(await h.bridge.endUnconfirmedInput(target)).toBe('applied')
  expect(sent).toHaveBeenCalledTimes(1)
})

it('keeps a missing original receipt pending and rejects the same frozen identity after the session changes', async () => {
  const h = await fixture()
  const sent = vi.spyOn(h.api, 'dispatch').mockRejectedValueOnce(new Error('transport unavailable'))
  await h.bridge.edit([{ type: 'instance.remove', instanceId: 'after' }]).catch(() => {})
  const target = h.bridge.captureUnconfirmedInput()!, lookup = vi.spyOn(h.api, 'lookup')
  expect(await h.bridge.queryUnconfirmedInput(target)).toEqual({ status: 'pending' })
  expect(await h.bridge.endUnconfirmedInput(target)).toBe('pending')
  expect(h.bridge.read().pending).toBe(1)
  expect(h.model().project.instances.after).toBeDefined()
  expect(sent).toHaveBeenCalledTimes(1)
  const recovery = structuredClone(h.durable.get(target.documentId)!)
  h.bridge.dispose()
  await h.registry.close(target.documentId, { discardDirty: true })
  await h.registry.restore(recovery)
  await h.bridge.connect(h.api)
  expect(h.bridge.read().snapshot!.epoch).not.toBe(target.epoch)
  const before = lookup.mock.calls.length
  await expect(h.bridge.queryUnconfirmedInput(target)).rejects.toThrow('文档会话已改变')
  await expect(h.bridge.endUnconfirmedInput(target)).rejects.toThrow('文档会话已改变')
  expect(lookup).toHaveBeenCalledTimes(before)
  expect(h.bridge.captureUnconfirmedInput()).toBeNull()
})

it('ends only the confirmed unapplied proposal without a read gate or releasing its foreign dependent', async () => {
  const h = await fixture(), started = deferred(), release = deferred()
  const sent = vi.spyOn(h.api, 'dispatch').mockImplementationOnce(async operation => {
    started.resolve(); await release.promise
    return { status: 'failed', applied: false, documentId: operation.documentId,
      operationId: operation.operationId, code: 'refused', message: 'Definite zero-write refusal' } satisfies DocumentOperationResult
  })
  const first = h.bridge.edit([{ type: 'instance.remove', instanceId: 'after' }]).catch(error => error)
  await started.promise
  const second = h.bridge.edit([{ type: 'style.set', instanceId: 'root', path: ['gap'], value: 24 }]).catch(error => error)
  await vi.waitFor(() => expect(h.bridge.read().pending).toBe(2))
  release.resolve()
  const failure = await first, dependent = await second, target = h.bridge.captureUnconfirmedInput()!
  expect(target.operationId).toBe(failure.operationId)
  const read = vi.spyOn(h.api, 'read').mockRejectedValue(new Error('temporary snapshot failure'))
  expect(await h.bridge.endUnconfirmedInput(target)).toBe('ready')
  expect(read).not.toHaveBeenCalled()
  expect(h.bridge.read().pending).toBe(1)
  expect(h.bridge.captureUnconfirmedInput()!.operationId).toBe(dependent.operationId)
  expect(h.model().project.instances.after).toBeDefined()
  expect(h.first.read().undoDepth).toBe(0)
  expect(sent).toHaveBeenCalledTimes(1)
  const next = h.bridge.captureUnconfirmedInput()!
  expect(await h.bridge.endUnconfirmedInput(next)).toBe('ready')
  expect(h.bridge.read().pending).toBe(0)
  expect(read).not.toHaveBeenCalled()
  expect(sent).toHaveBeenCalledTimes(1)
})
