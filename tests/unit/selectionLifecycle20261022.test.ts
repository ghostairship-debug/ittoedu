import { expect, it, vi } from 'vitest'
import { captureSelection, SelectionContextController, selectionReference, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { elementCardKey, elementCards, type ElementCardView } from '../../src/renderer/workbench/elementCards/elementCardController'
import { createComponentElementCardNavigation } from '../../src/renderer/workbench/elementCards/ElementCardIndicator'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionSelectionTarget } from '../../src/shared/workbench/executionDesktop'

const snapshot = (epoch = 'original'): DocumentSnapshot => ({ documentId: 'focus', epoch, revision: 1,
  model: { kind: 'markdown', source: '甲乙丙丁', resources: { assets: {}, components: {} } },
  binding: { kind: 'untitled', suggestedName: 'focus.md' }, dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 })
const capture = (value: DocumentSnapshot, from = 0) => captureSelection(value, [{ kind: 'markdown-range', from, to: from + 1 }], '文字')

it('publishes renderer focus from its loaded snapshot without reading the full document', () => {
  const read = vi.fn(async () => snapshot()), controller = new SelectionContextController(read)
  const value = snapshot()
  controller.observeSnapshot('focus', 1, value, current => capture(current))
  expect(controller.getManual('focus')?.targets).toEqual([{ kind: 'markdown-range', from: 0, to: 1 }])
  controller.observeSnapshot('focus', 2, value, () => { throw new Error('stale projection must not be used') })
  expect(controller.getManual('focus')?.revision).toBe(1)
  expect(read).not.toHaveBeenCalled()
})

it('retires actual close resources and pending observations while preserving frozen pins and a reopened session', async () => {
  let finish!: (value: DocumentSnapshot) => void
  const controller = new SelectionContextController(() => new Promise<DocumentSnapshot>(resolve => { finish = resolve }))
  const original = snapshot(), selected = capture(original)
  controller.setManual('focus', selected)
  controller.setPinned([selectionReference(selected, false)])
  const closed = vi.fn(), clear = vi.fn()
  controller.subscribeDocumentClosed(closed)
  const unregisterOld = controller.registerSelectionClearer('focus', clear)
  controller.registerTargetView('focus', { rect: () => null, root: () => null, select: () => false })
  const pending = controller.observe('focus', 1, current => capture(current))
  controller.closeDocument('focus', original.epoch)
  expect(controller.getManual('focus')).toBeNull()
  expect(controller.targetView('focus')).toBeUndefined()
  expect(controller.getPinned('focus')).toEqual(selected)
  expect(closed).toHaveBeenCalledWith('focus', 'original')
  const reopened = snapshot('reopened')
  controller.observeSnapshot('focus', 1, reopened, current => capture(current, 2))
  const reopenedClear = vi.fn()
  controller.registerSelectionClearer('focus', reopenedClear)
  unregisterOld()
  controller.closeDocument('focus', 'original')
  finish(original); await pending
  expect(controller.getManual('focus')?.epoch).toBe('reopened')
  expect(controller.getManual('focus')?.targets).toEqual([{ kind: 'markdown-range', from: 2, to: 3 }])
  expect(closed).toHaveBeenCalledTimes(1)
  controller.removeSelection('focus', controller.getManual('focus')!.targets)
  expect(clear).not.toHaveBeenCalled()
  expect(reopenedClear).toHaveBeenCalledTimes(1)
})

it('keeps repeated scoped fields in separate AI cards and keeps one field through its acknowledged value change', () => {
  const field = (scope: string, initialValue: string): ExecutionSelectionTarget => ({ kind: 'course-instance', surfaceId: 'page', instanceId: 'list', stateId: null,
    authorField: { kind: 'text', authorKey: 'item-label', scope: { item: scope }, initialValue } })
  expect(elementCardKey('doc', field('a', '甲'))).not.toBe(elementCardKey('doc', field('b', '乙')))
  expect(elementCardKey('doc', field('a', '甲'))).toBe(elementCardKey('doc', field('a', '改后')))
})

it('returns an element card to its exact field using the current acknowledged value', async () => {
  const project = createBlankCourseProjectV10('字段定位'), surfaceId = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.fieldOwner = { id: 'fieldOwner', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('当前文字'))) }
  project.instances[surfaceId].childIds = ['fieldOwner']
  const host = await createV10StoreHost(project), opened = vi.spyOn(elementCards, 'requestOpen').mockImplementation(() => {})
  const documentId = host.first.documentId, target: ExecutionSelectionTarget = { kind: 'course-instance', surfaceId, instanceId: 'fieldOwner',
    authorField: { kind: 'text', dataPath: ['content', 'inlines', '0', 'text'], initialValue: '改前文字' } }
  const card = { documentId, epoch: host.first.read().epoch, key: 'field-card', label: '字段', target } as ElementCardView
  const error = vi.fn()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  try {
    createComponentElementCardNavigation({ kernel: host.kernel, reportError: error }).jump(card)
    await vi.waitFor(() => expect(opened).toHaveBeenCalledWith('field-card'))
    expect(error).not.toHaveBeenCalled()
    expect(host.bridge.read().interactionSelection).toEqual({ kind: 'author-field', instanceId: 'fieldOwner', field: { ...target.authorField, initialValue: '当前文字' } })
    expect(host.first.read().undoDepth).toBe(0)
  } finally {
    host.bridge.dispose(); opened.mockRestore(); vi.unstubAllGlobals()
  }
})

it('does not let a delayed card range selection overwrite a newer manual or Bridge selection in the same document', async () => {
  const project = createBlankCourseProjectV10('迟到定位'), surfaceId = project.rootIds[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('甲乙丙丁'))) }
  project.instances[surfaceId].childIds = ['body']
  const host = await createV10StoreHost(project), documentId = host.first.documentId
  const target: ExecutionSelectionTarget = { kind: 'course-instance', surfaceId, instanceId: 'body', dataPath: ['content'], from: 0, to: 1 }
  const card = { documentId, key: 'range-card', label: '范围', target } as ElementCardView
  const opened = vi.spyOn(elementCards, 'requestOpen').mockImplementation(() => {}), select = vi.fn(() => true)
  const unregister = workbenchSelection.registerTargetView(documentId, { rect: () => null, root: () => null, select })
  let frame: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  try {
    for (const changed of ['none', 'manual', 'bridge']) {
      opened.mockClear()
      createComponentElementCardNavigation({ kernel: host.kernel }).jump(card)
      await vi.waitFor(() => expect(opened).toHaveBeenCalledWith('range-card'))
      if (changed === 'manual') workbenchSelection.setManual(documentId, captureSelection(host.first.read(), [{ ...target, from: 1, to: 2 }], '新范围'))
      if (changed === 'bridge') host.bridge.selectInstances(documentId, ['body'], surfaceId)
      frame!(0)
      expect(select).toHaveBeenCalledTimes(1)
    }
  } finally {
    unregister(); workbenchSelection.setManual(documentId, null); host.bridge.dispose(); opened.mockRestore(); vi.unstubAllGlobals()
  }
})
