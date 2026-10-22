import { describe, expect, it } from 'vitest'
import { useEditorStore, type EditorState } from '../../src/renderer/store/editorStore'
import { selectPropertiesAuthoringReadModel } from '../../src/renderer/composition/properties/PropertiesAuthoringReadModel'

function emptyState(): EditorState {
  const state = useEditorStore.getState()
  return { ...state, slideContentEdit: null, courseView: { ...state.courseView,
    project: null, editingProject: null, snapshot: null, views: [], activeDocumentId: null,
    interactionSelection: null, selectedInstanceIds: [], error: null } }
}

describe('empty workbench properties snapshot', () => {
  it('returns one stable snapshot across repeated reads and unrelated store updates', () => {
    const state = emptyState(), first = selectPropertiesAuthoringReadModel(state)
    expect(first.project).toBeNull()
    expect(selectPropertiesAuthoringReadModel(state)).toBe(first)
    expect(selectPropertiesAuthoringReadModel({ ...state, statusMessage: 'unrelated' })).toBe(first)
  })

  it('keeps independent empty views stable while exposing changed owner facts', () => {
    const a = emptyState(), b = emptyState()
    const first = selectPropertiesAuthoringReadModel(a), second = selectPropertiesAuthoringReadModel(b)
    expect(selectPropertiesAuthoringReadModel(a)).toBe(first)
    expect(selectPropertiesAuthoringReadModel(b)).toBe(second)
    const changed = { ...a, courseView: { ...a.courseView, error: 'load failed' } }
    expect(selectPropertiesAuthoringReadModel(changed).error).toBe('load failed')
    expect(selectPropertiesAuthoringReadModel(changed)).toBe(selectPropertiesAuthoringReadModel(changed))
    expect(selectPropertiesAuthoringReadModel(a)).toBe(first)
  })
})
