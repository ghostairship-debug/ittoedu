import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import { TEXT_DEFINITION, createTextComponentData } from '../../src/components/text'
import { ComponentsTab } from '../../src/renderer/ui/ComponentsTab'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState(), previousDesktop = window.desktopAPI
const json = (value: unknown) => JSON.parse(JSON.stringify(value))
afterEach(() => { cleanup(); store().courseBridge.dispose(); Object.defineProperty(window, 'desktopAPI', { configurable: true, value: previousDesktop }) })

it('extracts the actual selected subtree and bytes to the library, then inserts from its project card with one saved History operation', async () => {
  const h = await createCourseDocumentHost(); await store().connectCourseDocuments(h.api)
  const project = createBlankCourseProjectV10('两栏教学片段'), definitionId = 'com.example.columns', bytes = new Uint8Array([1, 2, 3, 4])
  project.definitions[definitionId] = { id: definitionId, title: '两栏教学片段', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default { render() { return document.createElement("div") } }' } }
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION; project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.assets.photo = { id: 'photo', path: 'assets/photo.png', filename: 'photo.png', mimeType: 'image/png', kind: 'image', byteLength: 4, width: 800, height: 600 }
  project.instances.root = { id: 'root', definitionId, data: {}, childIds: ['text', 'image'], frame: { width: 700, height: 300, transform: [1, 0, 0, 1, 60, 80] } }
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: json(createTextComponentData({ inlines: [{ type: 'text', text: '观察与思考' }] })), frame: { width: 280, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: json(createImageData('photo')), frame: { width: 320, height: 240, transform: [1, 0, 0, 1, 330, 0] } }
  project.surfaces[0].childIds.push('root')
  await store().createCourseDocumentFrom(project, { assets: { photo: bytes }, components: {} })
  store().setEditingScope('scene'); store().selectNode('root')
  const documentId = store().courseView.activeDocumentId!, session = h.registry.get(documentId), before = session.read()
  const install = vi.fn(async (_input: { bytes: Uint8Array }) => ({ packageId: 'my-library', version: '1.0.0' }))
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { documents: h.api, installComponentLibraryEntry: install } })
  render(<ComponentsTab />)
  fireEvent.change(screen.getByLabelText('资产名称'), { target: { value: '优质两栏教学片段' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提炼到我的资产库' })) })
  await waitFor(() => expect(install).toHaveBeenCalledOnce())
  const entry = importComponentLibraryArchive(install.mock.calls[0]![0].bytes).entry
  expect(entry.title).toBe('优质两栏教学片段'); expect(entry.example.rootIds).toEqual(['root'])
  expect(entry.example.instances.root.childIds).toEqual(['text', 'image']); expect(Array.from(entry.resources.assets.photo)).toEqual(Array.from(bytes))
  expect(session.read()).toEqual(before)
  await act(async () => { fireEvent.click(screen.getByTestId(`component-${definitionId}`)); await store().courseBridge.drain() })
  const added = session.read(); if (added.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(added.undoDepth).toBe(before.undoDepth + 1)
  const roots = added.model.project.surfaces[0].childIds
  expect(roots).toHaveLength(2); expect(new Set(roots).size).toBe(2)
  const inserted = added.model.project.instances[roots[1]]
  expect(added.model.project.definitions[inserted.definitionId].implementation.kind).toBe('source'); expect(inserted.childIds).toHaveLength(2)
  expect(inserted.childIds).not.toEqual(['text', 'image'])
  expect(Array.from(added.model.resources.assets.photo)).toEqual(Array.from(bytes))
  const imageCopy = inserted.childIds!.map(id => added.model.kind === 'course-v10' ? added.model.project.instances[id] : null).find(item => item?.definitionId === IMAGE_DEFINITION.id)!
  const copiedAssetId = imageDataSchema.parse(imageCopy.data).assetId
  expect(copiedAssetId).not.toBe('photo'); expect(Array.from(added.model.resources.assets[copiedAssetId])).toEqual(Array.from(bytes))
  const reopened = h.driver.load(h.driver.serialize(added.model)); if (reopened.kind !== 'course-v10') throw new Error('Expected V10 archive')
  expect(reopened.project).toEqual(added.model.project)
  expect(reopened.resources.components).toEqual(added.model.resources.components)
  expect(Object.fromEntries(Object.entries(reopened.resources.assets).map(([id, value]) => [id, Array.from(value)]))).toEqual(Object.fromEntries(Object.entries(added.model.resources.assets).map(([id, value]) => [id, Array.from(value)])))
  await act(async () => { await store().courseBridge.undo(documentId) })
  expect(store().courseView.project!.instances).toEqual(project.instances)
})
