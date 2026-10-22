import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextComponentData } from '../../src/components/text'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

const text = (value: string) => JSON.parse(JSON.stringify(createTextComponentData(value)))
const frame = (x: number) => ({ width: 240, height: 70, transform: [1, 0, 0, 1, x, 20] as [number, number, number, number, number, number] })

it('retains one native object and shared text while editing only its local state frame through History and saved GLX', async () => {
  const project = createBlankCourseProjectV10('共同正文与局部布局'), rootId = project.rootIds[0]!
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions.slide = { id: 'slide', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.slide' } }
  project.instances[rootId].childIds = ['region', 'sibling']
  project.instances.region = { id: 'region', definitionId: 'slide', data: {}, childIds: ['native'],
    container: { kind: 'slide', presentation: { states: [
      { id: 'overview', title: '概览', overrides: {} }, { id: 'detail', title: '细节', overrides: {} },
    ] } } }
  project.instances.native = { id: 'native', definitionId: TEXT_DEFINITION.id, data: text('原共同正文'), frame: frame(10) }
  project.instances.sibling = { id: 'sibling', definitionId: TEXT_DEFINITION.id, data: text('同伴保留'), frame: frame(500) }
  const h = await createV10StoreHost(project)
  try {
    const id = h.first.documentId, sibling = structuredClone(project.instances.sibling)
    h.bridge.enterContainer(id, 'region')
    await h.bridge.edit([{ type: 'data.set', instanceId: 'native', path: [], value: text('改后的共同正文') }])
    h.bridge.selectPresentationState(id, 'detail', 'region')
    await h.bridge.edit([{ type: 'frame.set', instanceId: 'native', frame: frame(90) }])
    const edited = structuredClone(h.model().project)
    const shown = () => h.bridge.read().editingProject!.instances.native
    for (const stateId of ['overview', 'detail']) {
      h.bridge.selectPresentationState(id, stateId, 'region')
      expect(shown().data).toEqual(text('改后的共同正文'))
      expect(shown().frame).toEqual(frame(stateId === 'detail' ? 90 : 10))
    }
    expect(h.model().project.instances.native.frame).toEqual(frame(10))
    expect(h.model().project.instances.region.childIds).toEqual(['native'])
    expect(h.model().project.instances.sibling).toEqual(sibling)
    await h.bridge.undo(id)
    expect(shown().frame).toEqual(frame(10))
    expect(shown().data).toEqual(text('改后的共同正文'))
    await h.bridge.undo(id)
    expect(shown().data).toEqual(text('原共同正文'))
    await h.bridge.redo(id); await h.bridge.redo(id)
    expect(h.model().project.instances).toEqual(edited.instances)
    expect(await h.bridge.save(false, undefined, id)).toBe(true)
    await h.bridge.close(id); await h.bridge.open('saved.glx')
    const reopened = h.bridge.read().activeDocumentId!
    h.bridge.enterContainer(reopened, 'region')
    h.bridge.selectPresentationState(reopened, 'detail', 'region')
    expect(shown().frame).toEqual(frame(90))
    expect(shown().data).toEqual(text('改后的共同正文'))
    expect(h.bridge.read().project!.instances.region.childIds).toEqual(['native'])
    expect(h.bridge.read().project!.instances.sibling).toEqual(sibling)
  } finally { h.bridge.dispose() }
})
