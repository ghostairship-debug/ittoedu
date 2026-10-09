import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SceneThumbnail } from '../../src/renderer/ui/SceneThumbnail'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().courseBridge.dispose() })
it('draws playback-hidden content at its stable authored frame and opacity without mounting runtime', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const host = await createCourseDocumentHost(), store = () => useEditorStore.getState(), project = createBlankCourseProjectV10('缩略图')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('作者内容'))), frame: { width: 400, height: 200, transform: [1, 0, 0, 1, 280, 160] }, style: { opacity: .64 }, playbackInitialVisibility: 'hidden' }
  project.surfaces[0].childIds = ['text']
  await store().connectCourseDocuments(host.api); await store().createCourseDocumentFrom(project)
  const before = host.registry.get(store().courseView.activeDocumentId!).read()
  const { container } = render(<SceneThumbnail locationId={project.surfaces[0].id} />)
  await waitFor(() => expect(container.textContent).toContain('作者内容'))
  const content = container.querySelector('.scene-thumbnail > div > div') as HTMLElement
  expect(content.style.width).toBe('400px'); expect(content.style.height).toBe('200px')
  expect(content.style.transform).toBe('matrix(1,0,0,1,280,160)'); expect(content.style.opacity).toBe('0.64')
  expect(content.style.display).not.toBe('none')
  expect(container.querySelector('iframe')).toBeNull()
  expect(host.registry.get(before.documentId).read()).toEqual(before)
})
