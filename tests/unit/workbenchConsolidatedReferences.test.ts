import { describe, expect, it, vi } from 'vitest'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionDocumentReference } from '../../src/shared/workbench/executionDesktop'
import { captureSelection, SelectionContextController } from '../../src/renderer/workbench/SelectionContextController'
import { mergeAutomaticReferences, pinReferences, referenceIdentity, splitComposerReferences } from '../../src/renderer/workbench/composerReferences'

const reference = (surfaceId: string, instanceIds: string[] = []): ExecutionDocumentReference => ({ documentId: 'project', epoch: 'epoch', revision: 2,
  writable: [{ kind: 'document' }], selection: instanceIds.length ? instanceIds.map(instanceId => ({ kind: 'course-instance', surfaceId, instanceId })) : [{ kind: 'course-surface', surfaceId }] })
describe('current automatic context and independent pins', () => {
  it('keeps A1/A2 and B fixed while the automatic page follows C, without losing the submitted snapshot', () => {
    let draft = splitComposerReferences([reference('A', ['A1', 'A2'])])
    draft = pinReferences(draft, draft.filter(item => item.displayLabel === '所选对象'))
    draft = pinReferences(draft, splitComposerReferences([reference('B')]))
    const submitted = structuredClone(draft)
    draft = mergeAutomaticReferences(draft, splitComposerReferences([reference('C')]))
    expect(draft.map(item => item.selection![0])).toEqual([{ kind: 'course-instance', surfaceId: 'A', instanceId: 'A1' }, { kind: 'course-instance', surfaceId: 'A', instanceId: 'A2' }, { kind: 'course-surface', surfaceId: 'B' }, { kind: 'course-surface', surfaceId: 'C' }])
    expect(submitted.at(-1)?.selection).toEqual([{ kind: 'course-surface', surfaceId: 'B' }])
    const removed = draft[1]!
    draft = draft.filter(item => referenceIdentity(item) !== referenceIdentity(removed))
    expect(draft.map(referenceIdentity)).not.toContain(referenceIdentity(removed))
    expect(draft.filter(item => item.pinned)).toHaveLength(2)
  })
  it('does not recreate a removed automatic item from unchanged focus and deduplicates refreshed logical pins', () => {
    const automatic = splitComposerReferences([reference('A', ['A1'])]), removed = new Set([referenceIdentity(automatic[1]!)])
    expect(mergeAutomaticReferences([], automatic, removed)).toHaveLength(1)
    const pinned = { ...automatic[1]!, referenceId: 'stable-pin-id', revision: 9, pinned: true }
    expect(mergeAutomaticReferences([pinned], automatic).filter(item => item.displayLabel === '所选对象')).toHaveLength(1)
  })
})
it('removing the current range clears its real selection and invalidates an earlier focus read, while another pin is harmless', async () => {
  const snapshot: DocumentSnapshot = { documentId: 'md', epoch: 'epoch', revision: 0, model: new MarkdownDriver().load(new TextEncoder().encode('一二三四五六')),
    binding: { kind: 'untitled', suggestedName: '未保存.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  let resolve!: (snapshot: DocumentSnapshot) => void
  const controller = new SelectionContextController(() => new Promise(done => { resolve = done }))
  const selected = captureSelection(snapshot, [{ kind: 'markdown-range', from: 0, to: 2 }], '当前文字'), clear = vi.fn()
  controller.registerSelectionClearer('md', clear); controller.setManual('md', selected)
  const oldFocus = controller.observe('md', 0, () => selected)
  controller.removeSelection('md', [{ kind: 'markdown-range', from: 3, to: 5 }])
  expect(clear).not.toHaveBeenCalled()
  controller.removeSelection('md', selected.targets)
  resolve(snapshot); await oldFocus
  expect(clear).toHaveBeenCalledOnce(); expect(controller.getManual('md')).toBeNull()
  controller.setManual('md', selected)
  expect(controller.getManual('md')).toEqual(selected)
})

it('current-work confirmation waits for the input owner ACK and returns the actual unsaved revision, rejecting a reopened epoch', async () => {
  const before: DocumentSnapshot = { documentId: 'confirm', epoch: 'epoch', revision: 0, model: new MarkdownDriver().load(new TextEncoder().encode('旧稿')),
    binding: { kind: 'untitled', suggestedName: '未保存.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  const controller = new SelectionContextController(async () => before)
  let ack!: (snapshot: DocumentSnapshot) => void
  controller.register('confirm', () => new Promise(resolve => { ack = resolve }))
  const question = { prompt: '当前稿可以吗？', questions: [{ id: 'q', header: '确认', question: '当前稿可以吗？', options: [{ label: '可以', description: '继续' }] }], currentDraft: [{ documentId: 'confirm', epoch: 'epoch', revision: 0, target: { kind: 'markdown-range', from: 0, to: 2 } }] } as unknown as Parameters<typeof controller.prepareQuestion>[0]
  const settled = vi.fn(), preparing = controller.prepareQuestion(question).then(settled)
  await Promise.resolve(); expect(settled).not.toHaveBeenCalled()
  ack({ ...before, revision: 3, model: new MarkdownDriver().load(new TextEncoder().encode('新')) }); await preparing
  expect(settled).toHaveBeenCalledWith([{ documentId: 'confirm', epoch: 'epoch', revision: 3 }])
  controller.register('confirm', async () => ({ ...before, epoch: 'reopened', revision: 7 }))
  await expect(controller.prepareQuestion(question)).rejects.toThrow('重新核对当前稿')
})
