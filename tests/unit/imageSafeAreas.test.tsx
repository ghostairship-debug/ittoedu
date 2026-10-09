import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createImageData, IMAGE_DEFINITION, imageDataSchema } from '../../src/components/image'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAuthorData } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'

it('defaults current image data to no guides and rejects overflow, duplicate identities and more than sixteen areas', () => {
  expect(imageDataSchema.parse({ assetId: 'art', originalAssetId: 'art' }).safeAreas).toEqual([])
  const area = { id: 'subject', label: '主体', x: .1, y: .1, width: .8, height: .8 }
  const data = createImageData('art')
  for (const safeAreas of [[{ ...area, x: .7 }], [area, area], Array.from({ length: 17 }, (_, index) => ({ ...area, id: String(index) }))])
    expect(imageDataSchema.safeParse({ ...data, safeAreas }).success).toBe(false)
})

it('edits stable safe-area identities through current Properties, undoes geometry, removes guides and enforces the sixteen-area limit', async () => {
  const project = createBlankCourseProjectV10('图片安全区')
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: courseAuthorData(createImageData('art')),
    frame: { width: 320, height: 180, transform: [1, 0, 0, 1, 40, 50] } }
  project.surfaces[0].childIds.push('image'); project.assets.art = { id: 'art', path: 'assets/art.png', mimeType: 'image/png' }
  const h = await createV10StoreHost(project, { assets: { art: new Uint8Array([1, 2, 3]) }, components: {} }), previous = useEditorStore.getState()
  const areas = () => imageDataSchema.parse(h.model().project.instances.image.data).safeAreas
  try {
    await previous.connectCourseDocuments(h.api); useEditorStore.getState().courseKernel.selectInstances(['image'])
    render(<PropertiesTab onReplaceImage={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '添加安全区' })) })
    await waitFor(() => expect(areas()).toHaveLength(1))
    const areaId = areas()[0].id
    expect(areas()[0]).toMatchObject({ id: expect.stringMatching(/^safe_area_/), label: '安全区 1', x: .1, width: .8 })
    const left = screen.getByRole('slider', { name: '左侧位置' })
    await act(async () => { fireEvent.change(left, { target: { value: '15' } }); fireEvent.pointerUp(left) })
    await waitFor(() => expect(areas()[0]).toMatchObject({ id: areaId, x: .15 }))
    await act(async () => { await useEditorStore.getState().courseBridge.undo() })
    expect(areas()[0]).toMatchObject({ id: areaId, x: .1 })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '删除安全区 安全区 1' })) })
    await waitFor(() => expect(areas()).toEqual([]))
    const full = Array.from({ length: 16 }, (_, index) => ({ id: `guide-${index}`, label: `安全区 ${index + 1}`, x: 0, y: 0, width: 1, height: 1 }))
    await act(async () => { await useEditorStore.getState().courseKernel.edit([{ type: 'data.set', instanceId: 'image', path: ['safeAreas'], value: courseAuthorData(full) }]) })
    const add = screen.getByRole('button', { name: '添加安全区' }), before = structuredClone(h.first.read())
    expect(add).toBeDisabled(); fireEvent.click(add); expect(h.first.read()).toEqual(before)
    const reopened = h.driver.load(h.driver.serialize(h.model()))
    if (reopened.kind !== 'course-v10') throw new Error('Expected a Course V10 archive')
    expect(reopened.project).toEqual(h.model().project)
    expect([...reopened.resources.assets.art]).toEqual([...h.model().resources.assets.art])
  } finally { cleanup(); useEditorStore.getState().courseBridge.dispose(); useEditorStore.setState(previous, true); h.bridge.dispose() }
})
