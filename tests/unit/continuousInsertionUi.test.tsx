import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  selectActiveScene,
  selectSelectedNodeId,
  selectSelectedNodeIds,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { NodesTab } from '@/renderer/ui/NodesTab'

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => cleanup())

describe('explicit layer selection', () => {
  it('opens properties when a user clicks a layer after insertion kept the elements tab', () => {
    const store = useEditorStore.getState()
    store.setActiveTab('elements')
    store.addTextNode()
    const node = selectActiveScene(useEditorStore.getState()).nodes[0]!
    expect(useEditorStore.getState().activeTab).toBe('elements')

    store.setActiveTab('layers')
    render(<NodesTab />)
    fireEvent.click(screen.getByText(node.name))

    expect(selectSelectedNodeId(useEditorStore.getState())).toBe(node.id)
    expect(useEditorStore.getState().activeTab).toBe('properties')
  })

  it('keeps a real double click in the layers tab so the selected node can be renamed', async () => {
    const user = userEvent.setup()
    const store = useEditorStore.getState()
    store.addTextNode()
    const node = selectActiveScene(useEditorStore.getState()).nodes[0]!
    store.setActiveTab('layers')
    render(<NodesTab />)

    await user.dblClick(screen.getByText(node.name))

    expect(useEditorStore.getState().activeTab).toBe('layers')
    expect(screen.getByRole('textbox', { name: `重命名“${node.name}”` }))
      .toBeInTheDocument()
  })

  it('keeps additive layer selection in the list until properties is explicitly requested', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addTextNode()
    const nodes = selectActiveScene(useEditorStore.getState()).nodes
    store.setActiveTab('layers')
    render(<NodesTab />)

    const unselectedName = screen.getAllByText('文本').find((element) => (
      !element.closest('.node-item')?.classList.contains('node-item--selected')
    ))
    expect(unselectedName).toBeDefined()
    fireEvent.click(unselectedName!, { ctrlKey: true })

    expect(selectSelectedNodeIds(useEditorStore.getState())).toHaveLength(2)
    expect(useEditorStore.getState().activeTab).toBe('layers')
    expect(nodes).toHaveLength(2)
  })
})
