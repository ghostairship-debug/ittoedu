import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { CourseEditorChromeContext } from '../../src/renderer/documents/CourseEditorChromeContext'
import { NativeSelectionContext } from '../../src/renderer/workbench/NativeSelectionContext'
import { authorFieldIdentity } from '../../src/renderer/documents/interactionSelection'
import { AUTHOR_FIELD_ACTION_EVENT, requestObjectContextMenu } from '../../src/renderer/editing/commands/objectContextMenu'
import type { ComponentAuthorSpot } from '../../src/shared/contracts/component-platform/runtime'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'

afterEach(() => { cleanup(); useEditorStore.getState().courseBridge.dispose() })

it('keeps field menus and edit requests precise when switching fields inside the same component', async () => {
  const host = await createCourseDocumentHost(), store = () => useEditorStore.getState()
  await store().connectCourseDocuments(host.api); store().setEditingScope('scene')
  store().addTextNode(); await store().drainCourseDocument()
  const documentId = store().courseView.activeDocumentId!, instanceId = store().courseView.selectedInstanceIds[0]!
  await store().courseKernel.edit([{ type: 'data.set', instanceId, path: ['content'], value: { inlines: [{ type: 'text', text: '甲' }, { type: 'text', text: '乙' }] } }])
  const spot = (field: string): ComponentAuthorSpot => ({ id: field, instanceId, kind: 'text', mountGeneration: 1, dataPath: ['content', 'inlines', field === 'labelA' ? '0' : '1', 'text'],
    initialValue: field === 'labelA' ? '甲' : '乙', localBounds: { width: 80, height: 30, transform: [1, 0, 0, 1, 0, 0] } })
  store().courseBridge.selectAuthorSpot(documentId, spot('labelA'), store().courseView.surfaceId)
  function CurrentSelection() {
    const view = useEditorStore(state => state.courseView)
    const selected = view.interactionSelection
    const liveSpot = selected?.kind === 'author-field' ? { ...spot(selected.field.dataPath![2] === '0' ? 'labelA' : 'labelB'), ...selected.field } : undefined
    return <CourseEditorChromeContext.Provider value={{ documentId, mode: 'light', setMode() {} }}><main data-testid="canvas">
      <NativeSelectionContext documentId={documentId} revision={view.snapshot?.revision ?? 0} surfaceId={view.surfaceId} itemIds={view.selectedInstanceIds}
        enabled authorSpot={liveSpot} authorBounds={() => ({ left: 100, top: 100, width: 80, height: 30 })} />
    </main></CourseEditorChromeContext.Provider>
  }
  render(<CurrentSelection />)
  const root = screen.getByTestId('canvas'), firstIdentity = authorFieldIdentity(instanceId, spot('labelA'))
  await screen.findByRole('toolbar', { name: '选中对象快捷工具' })
  act(() => { expect(requestObjectContextMenu(root, { x: 10, y: 10, itemIds: [instanceId], selectionIdentity: firstIdentity })).toBe(true) })
  expect(screen.getByRole('menuitem', { name: '编辑此处文字' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: '删除' })).toBeNull()
  act(() => { store().courseBridge.selectAuthorSpot(documentId, spot('labelB'), store().courseView.surfaceId) })
  expect(screen.queryByRole('menuitem', { name: '编辑此处文字' })).toBeNull()
  act(() => { expect(requestObjectContextMenu(root, { x: 10, y: 10, itemIds: [instanceId], selectionIdentity: firstIdentity })).toBe(false) })
  let requestedIdentity = ''
  const listener = (event: Event) => { requestedIdentity = (event as CustomEvent<{ selectionIdentity: string }>).detail.selectionIdentity; event.preventDefault() }
  window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, listener)
  try {
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: '编辑此处文字' }))
    expect(requestedIdentity).toBe(authorFieldIdentity(instanceId, spot('labelB')))
  } finally { window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, listener) }
  const beforeSnapshot = store().courseView.snapshot
  const rebound = { ...spot('labelB'), sourceRegion: { kind: 'data' as const, path: ['content', 'inlines', '1', 'text'], start: 0, end: 1 }, bindingStatus: 'bound' as const }
  act(() => { store().courseBridge.selectAuthorSpot(documentId, rebound, store().courseView.surfaceId) })
  expect(store().courseView.snapshot).toBe(beforeSnapshot)
  expect(authorFieldIdentity(instanceId, rebound)).toBe(authorFieldIdentity(instanceId, spot('labelB')))
  expect(workbenchSelection.getManual(documentId)?.targets[0]).toMatchObject({ authorField: { sourceRegion: rebound.sourceRegion, bindingStatus: 'bound' } })
})
