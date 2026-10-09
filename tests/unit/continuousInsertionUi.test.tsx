import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useEditorStore } from '@/renderer/store/editorStore'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
beforeEach(async () => { const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api); store().setEditingScope('scene') })
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })

it('keeps continuous insertion in Elements, opens Properties on explicit selection, and keeps additive selection in Layers', async () => {
  store().setActiveTab('elements')
  await store().addTextNode()
  const first = store().courseView.selectedInstanceId!
  expect(store().activeTab).toBe('elements')
  store().setActiveTab('layers')
  render(<NodesTab />)
  fireEvent.click(screen.getByTestId('node-item-' + first).querySelector('.node-name')!)
  await waitFor(() => expect(store().activeTab).toBe('properties'))
  expect(store().courseView.selectedInstanceId).toBe(first)
  await act(async () => { await store().addTextNode() })
  const second = store().courseView.selectedInstanceId!
  act(() => store().setActiveTab('layers'))
  const unselected = screen.getByTestId('node-item-' + first).querySelector('.node-name')!
  fireEvent.click(unselected, { ctrlKey: true })
  expect(store().courseView.selectedInstanceIds).toEqual(expect.arrayContaining([first, second]))
  expect(store().courseView.selectedInstanceIds).toHaveLength(2)
  expect(store().activeTab).toBe('layers')
})

it('handles a real double click as a rename, preserving the Layers tab and committing one history step', async () => {
  const user = userEvent.setup()
  await store().addTextNode()
  const id = store().courseView.selectedInstanceId!, original = store().courseView.snapshot!
  store().setActiveTab('layers'); render(<NodesTab />)
  const name = screen.getByTestId('node-item-' + id).querySelector('.node-name')!
  const label = name.textContent!
  await user.dblClick(name)
  expect(store().activeTab).toBe('layers')
  const input = screen.getByRole('textbox', { name: `重命名“${label}”` })
  await act(async () => { fireEvent.change(input, { target: { value: '课题' } }); fireEvent.keyDown(input, { key: 'Enter' }); await store().courseBridge.drain() })
  expect(store().courseView.project!.instances[id].name).toBe('课题')
  expect(store().courseView.snapshot!.undoDepth).toBe(original.undoDepth + 1)
})
