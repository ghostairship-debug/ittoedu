import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { renderHook, cleanup } from '@testing-library/react'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { usePropertiesAuthoringBinding } from '../../src/renderer/composition/properties/usePropertiesAuthoringBinding'

it('CA375 measured vertical width reaches the author draft and the canonical frame while retaining height and affine', async () => {
  const project = createBlankCourseProjectV10(), data = createTextData('Vertical'); data.appearance.writingMode = 'vertical-rl'
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)), frame: { width: 50, height: 140, transform: [2, 0, 0, 2, 30, 40] } }
  testContainerInstance(project, 0).childIds.push('text')
  const host = await createV10StoreHost(project); let state = createInitialSlideOwnedState()
  try {
    const author = createSlideAuthoringSlice(host.kernel, { read: () => state, patch: patch => { state = { ...state, ...patch } } })
    author.beginSlideDataEdit('text'); author.updateSlideDataDraft(project.instances.text.data, false, 140, 230)
    expect(state.slideContentEdit?.frame).toEqual({ width: 230, height: 140, transform: [2, 0, 0, 2, 30, 40] })
    await author.commitSlideContentEdit()
    expect(host.bridge.read().editingProject?.instances.text.frame).toEqual({ width: 230, height: 140, transform: [2, 0, 0, 2, 30, 40] })
  } finally { host.bridge.dispose() }
})

it('CA127 actual properties binding exposes inherited locked children and disables multi-selection deletion', async () => {
  const project = createBlankCourseProjectV10(), frame = { width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] }
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const id of ['parent', 'a', 'b', 'healthy']) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData(id))), frame }
  project.instances.parent!.locked = true; project.instances.parent!.childIds = ['a', 'b']; testContainerInstance(project, 0).childIds.push('parent', 'healthy')
  const host = await createV10StoreHost(project, undefined, false)
  try {
    await useEditorStore.getState().connectCourseDocuments(host.api); useEditorStore.getState().selectNodes(['a', 'b', 'healthy'])
    const hook = renderHook(() => usePropertiesAuthoringBinding({ onReplaceImage() {} })), context = hook.result.current
    if (context.kind !== 'multi-selection') throw Error('Expected actual multi-selection properties owner')
    expect(context.items.map(item => item.locked)).toEqual([true, true, false]); expect(context.items.filter(item => !item.locked)).toHaveLength(1)
    expect(context.commands.remove).toBeNull(); expect(context.commands.duplicate).toBeTypeOf('function')
  } finally { cleanup(); useEditorStore.getState().courseBridge.dispose() }
})
