import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ComponentsTab } from '../../src/renderer/ui/ComponentsTab'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../src/renderer/store/editorStore'
import { compositionFragmentFixture } from '../helpers/compositionFragmentFixture'
import { createTriageT4StoreHost } from '../helpers/triage-t4-store-host'

afterEach(cleanup)

it('exposes real extraction and insertion in the existing library and commits each action through DocumentSession', async () => {
  const host = await createTriageT4StoreHost()
  const source = compositionFragmentFixture()
  await host.open(source.project, [], source.assetFiles)
  useEditorStore.getState().selectNode(source.item.layerItemId)
  render(<ComponentsTab />)
  fireEvent.click(screen.getByTestId('extract-composition-fragment'))
  fireEvent.change(screen.getByLabelText('结构资产名称'), { target: { value: '优质两栏教学片段' } })
  fireEvent.click(screen.getByRole('button', { name: /^提取$/ }))
  await useEditorStore.getState().drainCourseDocument()
  await waitFor(() => expect(screen.getByText('优质两栏教学片段')).toBeTruthy())
  let state = useEditorStore.getState()
  const data = Object.values(state.componentPackages).find(data => data.manifest.content?.kind === 'composition')!
  expect(data.runtimeSource).toBe('')
  const session = host.registry.get(state.courseDocument.documentId!)
  expect(session.read().undoDepth).toBe(1)
  fireEvent.click(screen.getByTestId(`component-${data.manifest.id}`))
  await useEditorStore.getState().drainCourseDocument()
  state = useEditorStore.getState()
  const doc = selectActiveCourseProjectDocument(state)!
  const items = doc.surfaces.find(surface => surface.type === 'slide')!.scenes[0]!.layerItems
  expect(items.filter(item => item.kind === 'composition')).toHaveLength(2)
  expect(items.filter(item => item.kind === 'component')).toHaveLength(0)
  expect(session.read().undoDepth).toBe(2)
  expect(Object.keys(doc.assets)).toEqual(['source-photo'])
  await host.api.save(session.documentId, 'assets-saved.h5lesson')
  await host.api.open('assets-saved.h5lesson')
}, 30000)
