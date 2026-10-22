// @vitest-environment node
import { Worker } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { applyOfficeContentOffThread, inspectOfficeContentOffThread } from '../../src/main/workbench/office/officeContentWorker'
import { OfficeFileService, type OfficeFileHost } from '../../src/main/workbench/office/OfficeFileService'
import type { OfficeContentRequest } from '../../src/shared/workbench/officeFiles'
import { AgentFileOutcomeUnknown } from '../../src/core/tools/AgentFileTools'

afterEach(() => vi.restoreAllMocks())

it('uses a real worker without detaching input bytes and preserves validation errors', async () => {
  const created = await applyOfficeContentOffThread(undefined, { format: 'xlsx', operation: 'create', sheets: [{ name: 'Data', rows: [[2, { formula: 'A1*3' }]] }] })
  const input = created.bytes.slice(), byteLength = input.byteLength
  const edited = await applyOfficeContentOffThread(input, { format: 'xlsx', operation: 'edit', edits: [{ sheet: 'Data', cell: 'A1', value: 4 }] })
  expect(input.byteLength).toBe(byteLength)
  expect(await inspectOfficeContentOffThread(input, 'xlsx')).toMatchObject({ sheets: [{ cells: [{ cell: 'A1', value: 2 }, { cell: 'B1', formula: 'A1*3', value: 6 }] }] })
  expect(edited.calculation).toMatchObject({ status: 'complete', values: [{ cell: 'B1', value: 12 }] })
  await expect(applyOfficeContentOffThread(undefined, { format: 'unsupported' } as unknown as OfficeContentRequest)).rejects.toBeInstanceOf(ZodError)
})

it('terminates just the active pure computation on abort and preserves its reason', async () => {
  const terminate = vi.spyOn(Worker.prototype, 'terminate'), controller = new AbortController(), reason = new Error('用户停止本次Office计算')
  const pending = applyOfficeContentOffThread(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'cancelled' }] }, controller.signal)
  controller.abort(reason)
  await expect(pending).rejects.toBe(reason)
  expect(terminate).toHaveBeenCalledOnce()
})

function publicationHost(controller: AbortController, failRead = false): OfficeFileHost {
  let bytes: Uint8Array
  const binding = { path: 'D:/lesson.docx', fileVersion: 'saved', bindingVersion: 1 }
  return { artifacts: {
    bind: async () => binding,
    read: async () => { if (failRead) throw new Error('读取已写入结果失败'); return bytes },
    replace: async () => { throw new Error('not used') },
  }, files: { createFile: async (input, beforeCommit) => {
    beforeCommit?.(); bytes = input.bytes; controller.abort(new Error('用户在发布后停止'))
    return { items: [{ status: 'success', targetPath: binding.path }] } as Awaited<ReturnType<OfficeFileHost['files']['createFile']>>
  } } }
}
const destination = { workspaceId: 'workspace', targetDirectoryId: 'root', name: 'lesson.docx', operationId: 'office-publish' }
const request = { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'published' }] } as const
it('confirms a completed publication even when its original signal aborts before worker readback', async () => {
  const controller = new AbortController(), service = new OfficeFileService(publicationHost(controller))
  const result = await service.create(destination, { ...request, blocks: [...request.blocks] }, { signal: controller.signal })
  expect(result.status).toBe('saved')
  expect(result.inspection).toMatchObject({ paragraphs: [{ text: 'published' }] })
})
it('keeps the existing unknown-outcome error when readback after publication fails', async () => {
  const controller = new AbortController(), service = new OfficeFileService(publicationHost(controller, true))
  await expect(service.create(destination, { ...request, blocks: [...request.blocks] }, { signal: controller.signal })).rejects.toBeInstanceOf(AgentFileOutcomeUnknown)
})
