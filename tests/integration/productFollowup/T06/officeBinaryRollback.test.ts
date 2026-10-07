// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../../../src/main/workbench/office/OfficeContentService'
import { ExecutionChangeReviewService } from '../../../../src/main/workbench/review/ExecutionChangeReviewService'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../../src/shared/workbench/execution'

function run(root: string, tool: ExecutionToolRecord): ExecutionRunRecord {
  return { schemaVersion: 1, runId: 'office-run', version: 1, input: { conversationId: 'conversation', taskId: 'task',
    instruction: 'Revise a paragraph', documents: [], workspaceRoot: root }, status: 'completed', createdAt: 1,
    updatedAt: 2, messages: [], initialMessageCount: 0, requests: [], tools: [tool] } as ExecutionRunRecord
}

it('reviews a real DOCX edit as saved binary content, restores the original paragraphs and refuses to overwrite a later human edit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T06-office-'))
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const registered = await host.files.registerRoot(workspace)
    const office = new OfficeFileService(host)
    const review = new ExecutionChangeReviewService(host, path.join(directory, 'review'))
    const created = await office.create({ operationId: 'create-docx', workspaceId: registered.workspaceId, targetDirectoryId: registered.rootEntryId, name: 'lesson.docx' },
      { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Original teacher paragraph' }, { type: 'paragraph', text: 'Keep unrelated paragraph' }] })
    const edit = async (callId: string, binding: typeof created.binding) => {
      await review.prepareFileMutation({ runId: 'office-run', callId, name: 'office.edit', paths: [created.binding.path] })
      const saved = await office.edit(binding, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'Agent revised paragraph' }] })
      const tool: ExecutionToolRecord = { callId, providerCallId: callId, requestId: 'request', call: { name: 'office.edit', input: {} }, state: 'returned',
        result: { kind: 'read', data: { ...saved, path: saved.binding.path, saved: true } } }
      await review.completeFileMutation({ runId: 'office-run', callId, result: tool.result! })
      return run(workspace, tool)
    }
    const first = await edit('edit-first', created.binding)
    expect((await review.inspect(first)).entries[0]).toMatchObject({ source: 'host-file', status: 'applied', availability: 'ready' })
    expect(await review.rollback(first, 'edit-first', { workspaceRoot: workspace, permission: 'workspace' })).toMatchObject({ status: 'reverted', saved: true })
    const restored = inspectOfficeContent(await fs.readFile(created.binding.path), 'docx')
    if (restored.format !== 'docx') throw new Error('Expected DOCX')
    expect(restored.paragraphs.map(paragraph => paragraph.text)).toEqual(['Original teacher paragraph', 'Keep unrelated paragraph'])
    const current = await host.artifacts.bind(created.binding.path)
    const second = await edit('edit-second', current)
    const human = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'Later human paragraph' }] })
    await fs.writeFile(created.binding.path, human.bytes)
    expect((await review.inspect(second)).entries[0]).toMatchObject({ availability: 'conflict' })
    expect(await review.rollback(second, 'edit-second', { workspaceRoot: workspace, permission: 'workspace' })).toMatchObject({ status: 'conflict' })
    const untouched = inspectOfficeContent(await fs.readFile(created.binding.path), 'docx')
    if (untouched.format !== 'docx') throw new Error('Expected DOCX')
    expect(untouched.paragraphs[0].text).toBe('Later human paragraph')
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
