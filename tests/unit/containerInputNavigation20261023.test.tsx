import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { BottomSceneNavigator } from '../../src/renderer/ui/BottomSceneNavigator'
import { registerFlowWorkspaceDrain } from '../../src/renderer/document/flowWorkspaceRegistry'
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { nestedFlowSizingFixture } from '../helpers/nestedFlowSizingFixture'

vi.mock('../../src/renderer/ui/SceneThumbnail', () => ({ SceneThumbnail: () => <span /> }))
const releases: (() => void)[] = [], state = () => useEditorStore.getState()
afterEach(() => { cleanup(); releases.splice(0).forEach(release => release()); state().courseBridge.dispose() })
async function setup() {
  const project = nestedFlowSizingFixture()
  project.instances.next = { id: 'next', definitionId: 'slide', name: '下一页', data: {}, childIds: [], container: { kind: 'slide' } }
  project.rootIds.push('next')
  const host = await createV10StoreHost(project, undefined, false)
  await state().connectCourseDocuments(host.api)
  state().setEditingScope('scene')
  return { host, documentId: state().courseView.activeDocumentId! }
}

it('keeps the current Flow and unfinished IME when the bottom page card requests another context', async () => {
  const { host, documentId } = await setup(), before = host.first.read()
  releases.push(registerFlowWorkspaceDrain(documentId, async () => ({ ok: false, reason: '请先完成中文输入' })))
  render(<BottomSceneNavigator documentId={documentId} />)
  await act(async () => { fireEvent.click(within(screen.getByTestId('bottom-scene-next')).getByRole('button', { name: /页面/ })) })
  expect(state().courseView).toMatchObject({ rootInstanceId: 'root', surfaceId: 'root' })
  expect(state().errorMessage).toContain('当前编辑未能应用')
  expect(host.first.read()).toEqual(before)
})

it.each(['container', 'scope', 'document'] as const)('cancels a late input handoff after the %s changes, while keeping the accepted draft', async changed => {
  const { host, documentId } = await setup(), gate = deferred(), started = deferred()
  const off = registerFlowWorkspaceDrain(documentId, async () => {
    started.resolve(); await gate.promise
    await state().courseBridge.edit([{type:'instance.patch',instanceId:'long',patch:{name:'已接收的草稿'}}], undefined, documentId)
    return {ok:true}
  }); releases.push(off)
  const pending = state().navigateCourseView(id => state().courseBridge.enterContainer(id, 'child'))
  await started.promise
  if (changed === 'container') state().courseBridge.enterContainer(documentId, 'space')
  else if (changed === 'scope') state().setEditingScope('global')
  else {
    const next = await host.api.create(host.model(), 'second.glx')
    await state().courseBridge.activate(next.documentId)
  }
  gate.resolve(); expect(await pending).toBe(false)
  expect((host.first.read().model as any).project.instances.long.name).toBe('已接收的草稿')
  expect(state().courseView.editingContainerId).not.toBe('child')
  if (changed === 'scope') expect(state().editingScope).toBe('global')
  if (changed === 'container') expect(state().courseView.editingContainerId).toBe('space')
  expect(host.first.read().undoDepth).toBe(1)
})

it('enters and returns through the same Bridge with the original selection, entry and History', async () => {
  const { host, documentId } = await setup(), before = host.first.read()
  state().courseBridge.selectInstances(documentId, ['child'])
  expect(await state().navigateCourseView(id => state().courseBridge.enterContainer(id, 'child'))).toBe(true)
  expect(state().courseView).toMatchObject({rootInstanceId:'root',editingContainerId:'child',surfaceId:'child'})
  expect(await state().navigateCourseView(id => state().courseBridge.leaveContainer(id))).toBe(true)
  expect(state().courseView).toMatchObject({rootInstanceId:'root',editingContainerId:null,surfaceId:'root',selectedInstanceId:'child'})
  expect(host.first.read()).toEqual(before)
})
