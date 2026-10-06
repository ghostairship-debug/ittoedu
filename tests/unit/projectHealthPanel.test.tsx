import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { collectComponentProjectHealth } from '@/shared/componentProjectHealth'
import { selectActiveCourseProjectDocument, selectMediaAssetFiles, useEditorStore } from '@/renderer/store/editorStore'
import { ProjectHealthPanel } from '@/renderer/ui/ProjectHealthPanel'
import { DocumentHostService } from '@/main/workbench/DocumentHostService'
import type { DocumentHostAPI } from '@/shared/workbench/desktop'
import type { CourseProjectV10 } from '@/shared/contracts/component-platform/project'
import { createImageData, IMAGE_DEFINITION } from '@/components/image'

vi.mock('@/shared/componentProjectHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/componentProjectHealth')>()
  return { ...actual, collectComponentProjectHealth: vi.fn(actual.collectComponentProjectHealth) }
})

const dispose: Array<() => Promise<void>> = []
afterEach(async () => { cleanup(); for (const action of dispose.splice(0).reverse()) await action() })

it('collects the latest V10 project/resources only while open and locates a real nested missing-asset instance', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-health-'))
  dispose.push(() => rm(directory, { recursive: true, force: true }))
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'health-panel', revision: 0, title: '工程检查',
    definitions: { image: { ...IMAGE_DEFINITION, id: 'image' }, group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: { group: { id: 'group', definitionId: 'group', data: {}, childIds: ['picture'] },
      picture: { id: 'picture', definitionId: 'image', data: JSON.parse(JSON.stringify(createImageData('missing'))) } },
    surfaces: [{ id: 'other', kind: 'flow', title: '讲义', childIds: [] }, { id: 'slide', kind: 'slide', title: '缺图页', childIds: ['group'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const service = new DocumentHostService(path.join(directory, 'recovery'))
  await service.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '工程检查.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('fixture no dialog') }
  const api: DocumentHostAPI = { ...service.internalAPI, bootstrapCourse: () => service.bootstrapCourse(), saveWithDialog: unavailable,
    close: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable, subscribe: listener => service.subscribeEvents(listener) }
  await useEditorStore.getState().connectCourseDocuments(api)
  dispose.push(async () => useEditorStore.getState().courseBridge.dispose())
  vi.mocked(collectComponentProjectHealth).mockClear()
  const onClose = vi.fn(), { rerender } = render(<ProjectHealthPanel open={false} onClose={onClose} />)
  expect(collectComponentProjectHealth).not.toHaveBeenCalled()
  const before = selectActiveCourseProjectDocument(useEditorStore.getState())
  await act(async () => { await useEditorStore.getState().editComponents([{ type: 'instance.patch', instanceId: 'picture', patch: { name: '最新图片' } }]); await useEditorStore.getState().drainCourseDocument() })
  const latest = useEditorStore.getState()
  expect(selectActiveCourseProjectDocument(latest)).not.toBe(before)
  expect(collectComponentProjectHealth).not.toHaveBeenCalled()
  rerender(<ProjectHealthPanel open onClose={onClose} />)
  expect(collectComponentProjectHealth).toHaveBeenCalledOnce()
  expect(collectComponentProjectHealth).toHaveBeenCalledWith(selectActiveCourseProjectDocument(latest), { assetFiles: selectMediaAssetFiles(latest) })
  expect(screen.getByRole('dialog', { name: '工程检查' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '错误 · 演示页 · 缺图页' })).toBeInTheDocument()
  const issue = screen.getAllByText('image-asset-reference-missing')[0].closest('li')!
  fireEvent.click(within(issue).getByRole('button', { name: '定位' }))
  expect(useEditorStore.getState().courseView).toMatchObject({ surfaceId: 'slide', selectedInstanceId: 'picture' })
  expect(useEditorStore.getState().activeTab).toBe('properties')
  expect(onClose).toHaveBeenCalledOnce()
  rerender(<ProjectHealthPanel open={false} onClose={onClose} />)
  vi.mocked(collectComponentProjectHealth).mockClear()
  await act(async () => { await useEditorStore.getState().editComponents([{ type: 'instance.patch', instanceId: 'picture', patch: { name: '关闭后修改' } }]) })
  expect(collectComponentProjectHealth).not.toHaveBeenCalled()
})
