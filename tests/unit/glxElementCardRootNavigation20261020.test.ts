import { beforeAll as prepareProgramSourceForTests } from 'vitest'
import { loadBuiltinComponentSource } from '../../src/core/components/source/builtinSources'
prepareProgramSourceForTests(async () => { await loadBuiltinComponentSource('guoling.html-program') })
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlankProgramProject } from '../../src/core/course/createCourseProjectV10'
import { componentContainerBuiltinKey, createComponentContainerInstance } from '../../src/shared/contracts/component-platform/project'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { createComponentElementCardNavigation } from '../../src/renderer/workbench/elementCards/ElementCardIndicator'
import { elementCards, type ElementCardView } from '../../src/renderer/workbench/elementCards/elementCardController'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { ExecutionSelectionTarget } from '../../src/shared/workbench/executionDesktop'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'

const hosts: Awaited<ReturnType<typeof createV10StoreHost>>[] = []
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.spyOn(elementCards, 'requestOpen').mockImplementation(() => {})
})
afterEach(() => {
  for (const host of hosts.splice(0)) {
    for (const document of host.bridge.read().documents) workbenchSelection.setManual(document.documentId, null)
    host.bridge.dispose()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function card(documentId: string, surfaceId: string, instanceId: string, stateId?: string): ElementCardView {
  return { documentId, key: `${documentId}:${instanceId}`, label: '原元素',
    target: { kind: 'course-instance', surfaceId, instanceId, ...(stateId ? { stateId } : {}) } } as ElementCardView
}

async function fixture() {
  const project = createBlankProgramProject('程序根'), programId = project.rootIds[0]
  project.instances[programId].data = { html: '<p>原程序正文</p>', css: '' }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const kind of ['slide', 'flow'] as const) {
    const id = componentContainerBuiltinKey(kind)
    project.definitions[id] = { id, role: 'mixed', implementation: { kind: 'builtin', key: id } }
  }
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id,
    data: JSON.parse(JSON.stringify(createTextData(id))),
    frame: { width: 240, height: 80, transform: [1, 0, 0, 1, 20, 30] as [number, number, number, number, number, number] } })
  project.instances.native = text('native')
  project.instances.inner = text('inner')
  project.instances.slideText = text('slideText')
  const presentation = { states: [{ id: 'detail', title: '同名局部状态', overrides: {} }] }
  project.instances.flow = createComponentContainerInstance({ id: 'flow', kind: 'slide', title: '内层演示',
    childIds: ['inner'], presentation: structuredClone(presentation) }, componentContainerBuiltinKey('slide'))
  project.instances.slide = createComponentContainerInstance({ id: 'slide', kind: 'slide', title: '演示根',
    childIds: ['slideText'], presentation: structuredClone(presentation) }, componentContainerBuiltinKey('slide'))
  project.instances[programId].childIds = ['native', 'flow']
  project.rootIds.push('slide')
  const host = await createV10StoreHost(project)
  hosts.push(host)
  host.kernel.selectSurface('slide')
  host.bridge.selectPresentationState(host.first.documentId, 'detail', 'slide')
  return { ...host, programId }
}

it.each(['program', 'native', 'slide'] as const)('jumps the %s element card to its actual root without author writes', async kind => {
  const host = await fixture(), documentId = host.first.documentId, errors = vi.fn()
  const rootId = kind === 'slide' ? 'slide' : host.programId
  const instanceId = kind === 'program' ? host.programId : kind === 'slide' ? 'slideText' : 'native'
  const targetCard = card(documentId, rootId, instanceId)
  const before = structuredClone(host.first.read())
  const stateSelection = vi.spyOn(host.bridge, 'selectPresentationState')
  const navigation = createComponentElementCardNavigation({ kernel: host.kernel, reportError: errors })
  expect(navigation.exists(targetCard)).toBe(true)
  navigation.jump(targetCard)
  await vi.waitFor(() => expect(elementCards.requestOpen).toHaveBeenCalledWith(targetCard.key))
  expect(errors).not.toHaveBeenCalled()
  expect(host.bridge.read()).toMatchObject({ rootInstanceId: rootId, surfaceId: kind === 'slide' ? 'slide' : null,
    selectedInstanceIds: [instanceId] })
  expect(stateSelection).toHaveBeenCalledTimes(kind === 'slide' ? 1 : 0)
  expect(workbenchSelection.getManual(documentId)?.targets).toEqual([targetCard.target])
  expect(host.first.read()).toEqual(before)
})

it('crosses to the owning root before entering a nested container and restores only its captured state', async () => {
  const host = await fixture(), documentId = host.first.documentId, errors = vi.fn()
  const targetCard = card(documentId, 'flow', 'inner', 'detail'), before = structuredClone(host.first.read())
  const navigation = createComponentElementCardNavigation({ kernel: host.kernel, reportError: errors })
  navigation.jump(targetCard)
  await vi.waitFor(() => expect(elementCards.requestOpen).toHaveBeenCalledWith(targetCard.key))
  expect(errors).not.toHaveBeenCalled()
  expect(host.bridge.read()).toMatchObject({ rootInstanceId: host.programId, surfaceId: 'flow', editingContainerId: 'flow',
    activeStateId: 'detail', selectedInstanceIds: ['inner'], presentationStates: { slide: 'detail', flow: 'detail' } })
  expect(workbenchSelection.getManual(documentId)?.targets).toEqual([targetCard.target])
  expect(host.first.read()).toEqual(before)
})

it('retains the original card document and target while another tab is selected during the drain', async () => {
  const host = await fixture(), documentId = host.first.documentId, errors = vi.fn()
  const entered = deferred(), release = deferred()
  const other = await host.api.create(host.model(), 'other.glx')
  const targetCard = card(documentId, host.programId, 'native'), originalTarget = structuredClone(targetCard.target)
  const originalKey = targetCard.key
  const navigation = createComponentElementCardNavigation({ kernel: host.kernel, reportError: errors,
    drainDocument: async id => { entered.resolve(); await release.promise; return host.api.read(id) } })
  navigation.jump(targetCard)
  await entered.promise
  await host.bridge.activate(other.documentId)
  host.kernel.selectSurface('slide', other.documentId)
  host.kernel.selectInstances(['slideText'], 'slide', other.documentId)
  const otherBefore = structuredClone(host.bridge.read().views.find(view => view.documentId === other.documentId))
  targetCard.documentId = other.documentId
  targetCard.label = '后来的元素'
  targetCard.key = 'later-card'
  targetCard.target = { kind: 'course-instance', surfaceId: 'slide', instanceId: 'slideText' } satisfies ExecutionSelectionTarget
  release.resolve()
  await vi.waitFor(() => expect(elementCards.requestOpen).toHaveBeenCalledWith(originalKey))
  expect(errors).not.toHaveBeenCalled()
  expect(host.bridge.read().activeDocumentId).toBe(other.documentId)
  expect(host.bridge.read().views.find(view => view.documentId === other.documentId)).toEqual(otherBefore)
  expect(host.bridge.read().views.find(view => view.documentId === documentId)).toMatchObject({ rootInstanceId: host.programId, surfaceId: null, selectedInstanceIds: ['native'] })
  expect(workbenchSelection.getManual(documentId)).toMatchObject({ label: '原元素', targets: [originalTarget] })
  expect(workbenchSelection.getManual(other.documentId)).toBeNull()
  expect(host.first.read().undoDepth).toBe(0)
  expect(host.registry.get(other.documentId).read().undoDepth).toBe(0)
})
