import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseComponentApplyError, CourseComponentBlockedError, CourseComponentUnknownError, isCourseComponentInputFailure, type CourseComponentInputFailure } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { DocumentOperation, DocumentOperationResult } from '../../src/shared/workbench/document'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { setRootContainers } from '../helpers/glxWorkFixture'

const disposers: Array<() => void> = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); vi.restoreAllMocks() })

async function fixture() {
  const project = createBlankCourseProjectV10('属性输入结果核实')
  setRootContainers(project, [{ id: 'reading', kind: 'flow', title: '阅读', childIds: ['group', 'other'],
    flow: { layout: { widthMode: 'reading', readingWidth: 860, wideContentWidth: 1100 } } }])
  project.definitions.group = { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } }
  project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: [], style: { display: 'flex', gap: 12 } }
  project.instances.other = { id: 'other', definitionId: 'group', data: {}, childIds: [], style: { display: 'flex', gap: 9 } }
  const host = await createV10StoreHost(project)
  disposers.push(() => host.bridge.dispose())
  return host
}

const refused = (operation: DocumentOperation): DocumentOperationResult => ({ status: 'failed', documentId: operation.documentId,
  operationId: operation.operationId, code: 'fixture-property-rejected', message: '属性提交被拒绝', applied: false })
const edit = (host: Awaited<ReturnType<typeof fixture>>, instanceId: string, value: number) =>
  host.bridge.edit([{ type: 'style.set', instanceId, path: ['gap'], value }])
function failure(value: unknown): CourseComponentInputFailure {
  expect(isCourseComponentInputFailure(value)).toBe(true)
  if (!isCourseComponentInputFailure(value)) throw new Error('Expected an exact input resolution capability')
  return value
}

it('retains a definite rejection and releases only that proposal before an explicit fresh retry', async () => {
  const host = await fixture(), before = host.model().project
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(async operation => refused(operation))
  const rejected = failure(await edit(host, 'group', 48).catch(error => error))
  expect(rejected).toBeInstanceOf(CourseComponentApplyError)
  expect(host.model().project.instances).toEqual(before.instances)
  expect(host.first.read().undoDepth).toBe(0)
  expect(host.bridge.read().project!.instances.group.style?.gap).toBe(48)
  expect(host.bridge.read().pending).toBe(1)
  expect(await rejected.resolveInput('retry')).toBe('ready')
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(host.bridge.read().pending).toBe(0)
  expect(host.bridge.read().project!.instances).toEqual(before.instances)
  await edit(host, 'group', 32)
  expect(host.model().project.instances.group.style?.gap).toBe(32)
  expect(host.model().project.instances.other).toEqual(before.instances.other)
  expect(host.first.read().undoDepth).toBe(1)
  await host.bridge.undo()
  expect(host.model().project.instances).toEqual(before.instances)
})

it('queries an unknown original ID without releasing or dispatching it on retry or cancel', async () => {
  const host = await fixture()
  const dispatch = vi.spyOn(host.api, 'dispatch').mockRejectedValueOnce(new Error('transport disconnected'))
  const lookup = vi.spyOn(host.api, 'lookup')
  const unknown = failure(await edit(host, 'group', 48).catch(error => error))
  expect(unknown).toBeInstanceOf(CourseComponentUnknownError)
  expect(unknown).not.toBeInstanceOf(CourseComponentApplyError)
  const originalId = dispatch.mock.calls[0]![0].operationId
  expect(await unknown.resolveInput('retry')).toBe('pending')
  expect(await unknown.resolveInput('cancel')).toBe('pending')
  expect(lookup.mock.calls).toEqual([[host.first.documentId, originalId], [host.first.documentId, originalId]])
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(host.bridge.read().pending).toBe(1)
  expect(host.bridge.read().project!.instances.group.style?.gap).toBe(48)
  expect(host.model().project.instances.group.style?.gap).toBe(12)
  expect(host.first.read().undoDepth).toBe(0)
})

it('settles a lost successful ACK without applying the same property twice', async () => {
  const host = await fixture(), originalDispatch = host.api.dispatch.bind(host.api)
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(async (operation, options) => {
    await originalDispatch(operation, options)
    throw new Error('ACK lost after formal commit')
  })
  const unknown = failure(await edit(host, 'group', 48).catch(error => error))
  expect(host.model().project.instances.group.style?.gap).toBe(48)
  expect(host.first.read().undoDepth).toBe(1)
  expect(await unknown.resolveInput('retry')).toBe('applied')
  expect(host.bridge.read().pending).toBe(0)
  expect(host.bridge.read().project).toEqual(host.model().project)
  expect(await unknown.resolveInput('cancel')).toBe('applied')
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(host.first.read().undoDepth).toBe(1)
})

it('does not enqueue a ghost proposal when a different field is edited after a known failure', async () => {
  const host = await fixture()
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(async operation => refused(operation))
  const first = failure(await edit(host, 'group', 48).catch(error => error))
  await expect(edit(host, 'other', 60)).rejects.toThrow('属性提交被拒绝')
  expect(host.bridge.read().pending).toBe(1)
  expect(host.bridge.read().project!.instances.other.style?.gap).toBe(9)
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(await first.resolveInput('cancel')).toBe('ready')
  expect(host.bridge.read().pending).toBe(0)
  await edit(host, 'other', 60)
  expect(host.model().project.instances.other.style?.gap).toBe(60)
  expect(host.model().project.instances.group.style?.gap).toBe(12)
  expect(host.first.read().undoDepth).toBe(1)
})

it('keeps a previously queued dependent input independently resolvable without dispatching it', async () => {
  const host = await fixture()
  let rejectFirst: (() => void) | undefined
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(operation => new Promise(resolve => {
    rejectFirst = () => resolve(refused(operation))
  }))
  const firstPending = edit(host, 'group', 48).catch(error => error)
  await vi.waitFor(() => expect(rejectFirst).toBeDefined())
  const secondPending = edit(host, 'other', 60).catch(error => error)
  await vi.waitFor(() => expect(host.bridge.read().pending).toBe(2))
  rejectFirst!()
  const first = failure(await firstPending), second = failure(await secondPending)
  expect(second).toBeInstanceOf(CourseComponentBlockedError)
  expect(second.operationId).not.toBe(first.operationId)
  await expect(first.resolveInput('retry')).rejects.toThrow('其他未确认输入')
  expect(host.bridge.read().pending).toBe(1)
  expect(host.bridge.read().project!.instances.other.style?.gap).toBe(60)
  expect(host.model().project.instances.other.style?.gap).toBe(9)
  expect(await second.resolveInput('cancel')).toBe('ready')
  expect(host.bridge.read().pending).toBe(0)
  expect(host.bridge.read().project!.instances.other.style?.gap).toBe(9)
  expect(await first.resolveInput('retry')).toBe('ready')
  expect(dispatch).toHaveBeenCalledTimes(1)
  await edit(host, 'group', 32)
  expect(host.first.read().undoDepth).toBe(1)
  expect(host.model().project.instances.group.style?.gap).toBe(32)
  expect(host.model().project.instances.other.style?.gap).toBe(9)
})

it('does not overwrite a newer formal property during retry, while explicit cancel releases only old input', async () => {
  const host = await fixture()
  const dispatch = vi.spyOn(host.api, 'dispatch').mockImplementationOnce(async operation => refused(operation))
  const rejected = failure(await edit(host, 'group', 48).catch(error => error))
  const target = host.bridge.captureTarget(undefined, true)
  const captured = host.bridge.capture([{ type: 'style.set', instanceId: 'group', path: ['gap'], value: 24 }], target)
  await host.first.execute({ documentId: host.first.documentId, epoch: host.first.read().epoch, operationId: 'external-formal-gap',
    baseRevision: host.first.read().revision, actor: 'human', mutation: { type: 'command',
      command: { type: captured.type, edits: captured.edits, expected: captured.expected } } })
  await expect(rejected.resolveInput('retry')).rejects.toThrow('原属性已在其他位置改变')
  expect(host.model().project.instances.group.style?.gap).toBe(24)
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(await rejected.resolveInput('cancel')).toBe('ready')
  expect(host.bridge.read().project!.instances.group.style?.gap).toBe(24)
  expect(host.bridge.read().pending).toBe(0)
  expect(host.first.read().undoDepth).toBe(1)
})
